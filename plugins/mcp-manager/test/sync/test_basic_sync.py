import json
from test_sync import SyncFixture, server

class BasicSyncTests(SyncFixture):
    def test_toggle_does_not_write_other_clients(self):
        self.edit('codex', {'probe': server()})
        self.converge()
        before = {end: a.path.read_bytes() for end, a in self.sync.adapters.items()}
        p = self.sync.adapters['codex'].path
        p.write_text(p.read_text().replace('[mcp_servers.probe]', '[mcp_servers.probe]\nenabled = false'))
        self.sync.run()
        for end in ('claude', 'deepseek'):
            self.assertEqual(self.sync.adapters[end].path.read_bytes(), before[end])

    def test_harness_and_claude_toggles_never_propagate(self):
        self.edit('codex', {'probe': server()})
        self.converge()
        before = {end: a.path.read_bytes() for end, a in self.sync.adapters.items()}
        p = self.sync.adapters['deepseek'].path
        adapter = self.sync.adapters['deepseek']
        from mcp_sync import deepseek_rows
        from io import StringIO
        doc = adapter.parse(p.read_bytes()); row = deepseek_rows(doc)[0]['probe'][1]; row['disabled'] = True
        output = StringIO(); adapter.yaml.dump(doc, output); p.write_text(output.getvalue())
        self.sync.run()
        for end in ('codex', 'claude'):
            self.assertEqual(self.sync.adapters[end].path.read_bytes(), before[end])
        before = {end: a.path.read_bytes() for end, a in self.sync.adapters.items()}
        self.set_claude_project('/nonexistent-worktree', ['probe'])
        local = self.sync.adapters['claude'].path.read_bytes()
        self.converge()
        self.assertEqual(self.sync.adapters['claude'].path.read_bytes(), local)
        for end in ('codex', 'deepseek'):
            self.assertEqual(self.sync.adapters[end].path.read_bytes(), before[end])

    def test_content_updates_and_repaired_configuration_keep_local_switches(self):
        self.put('codex', '[mcp_servers.probe]\nurl = "http://127.0.0.1:8100/mcp"\nenabled = false\nstartup_timeout_sec = 42\n')
        self.converge()
        self.set_claude_project('/missing-project', ['probe'])
        projects = self.claude_doc()['projects']
        self.edit('deepseek', {'probe': server(8200)})
        self.converge()
        self.assertIn('enabled = false', self.sync.adapters['codex'].path.read_text())
        self.assertEqual(self.claude_doc()['projects'], projects)
        self.put('codex', 'model = "new-provider"\n')
        self.converge()
        restored = self.sync.adapters['codex'].path.read_text()
        self.assertIn('enabled = false', restored)
        self.assertIn('startup_timeout_sec = 42', restored)
        self.assertEqual(self.config('codex')['probe'], server(8200))
        self.assertNotIn('disabled:', self.sync.adapters['deepseek'].path.read_text())

    def test_old_toggle_pending_is_dropped_without_native_writes(self):
        self.edit('codex', {'probe': server()}); self.converge()
        baseline = dict(server(), enabled=True)
        state = {'version':3, 'base':{'probe':baseline}, 'pending':{'probe':{
            'before':{end:baseline for end in self.sync.adapters}, 'target':dict(baseline,enabled=False)}},
            'claude_disabled_projects':{'probe':['/missing']}}
        self.sync.save(state)
        before = {end:a.path.read_bytes() for end,a in self.sync.adapters.items()}
        self.converge()
        self.assertEqual({end:a.path.read_bytes() for end,a in self.sync.adapters.items()}, before)
        self.assertEqual(self.sync.load()['version'],4)
        self.assertEqual(self.sync.load()['pending'],{})
        self.assertNotIn('enabled', self.sync.load()['base']['probe'])

    def test_old_content_pending_survives_while_switch_does_not_propagate(self):
        self.edit('codex', {'probe':server()}); self.converge()
        self.sync.save({'version':3,'base':{'probe':dict(server(),enabled=True)},'pending':{'probe':{
            'before':{end:dict(server(),enabled=True) for end in self.sync.adapters},
            'target':dict(server(8200),enabled=False)}}})
        self.converge(); self.assert_all({'probe':server(8200)})
        self.assertNotIn('enabled = false',self.sync.adapters['codex'].path.read_text())
        self.assertNotIn('disabled:',self.sync.adapters['deepseek'].path.read_text())

    def test_old_verified_explicit_removal_survives_conversion(self):
        self.edit('codex',{'probe':server()}); self.converge()
        snapshots={end:a.read() for end,a in self.sync.adapters.items()}
        value=dict(server(),enabled=True)
        self.sync.save({'version':3,'base':{'probe':value},'pending':{'probe':{
            'before':{end:value for end in snapshots},'target':None,
            'expected_entries':{end:s.legacy_removal_key(end,'probe') for end,s in snapshots.items()}}}})
        self.converge(); self.assert_all({})

    def test_unverified_old_removal_stays_conflicted_without_writes(self):
        self.edit('codex',{'probe':server()}); self.converge()
        value=dict(server(),enabled=True)
        self.sync.save({'version':3,'base':{'probe':value},'pending':{'probe':{
            'before':{end:value for end in self.sync.adapters},'target':None,'expected_entries':{'codex':'unverified'}}}})
        before={end:a.path.read_bytes() for end,a in self.sync.adapters.items()}
        self.assertIn('probe',self.sync.run()['conflicts'])
        self.assertEqual({end:a.path.read_bytes() for end,a in self.sync.adapters.items()},before)
        self.assertIn('probe',self.sync.load()['pending'])

    def test_harness_repair_keeps_its_local_disabled_state_and_defaults_new_clients_on(self):
        from io import StringIO
        from mcp_sync import deepseek_rows, Sync
        self.edit('deepseek', {'probe':server()})
        adapter=self.sync.adapters['deepseek']; doc=adapter.parse(adapter.path.read_bytes())
        row=deepseek_rows(doc)[0]['probe'][1];row['disabled']=True;row['config']['toolCallTimeoutMs']=9876
        output=StringIO();adapter.yaml.dump(doc,output);adapter.path.write_text(output.getvalue())
        self.converge()
        self.assertNotIn('enabled = false',self.sync.adapters['codex'].path.read_text())
        self.assertNotIn('disabledMcpServers',self.sync.adapters['claude'].path.read_text())
        self.put('deepseek', '# replaced provider\n[]\n')
        self.sync=Sync(self.home,self.home/'state');self.converge()
        row=deepseek_rows(adapter.parse(adapter.path.read_bytes()))[0]['probe'][1]
        self.assertTrue(row['disabled']);self.assertEqual(row['config']['toolCallTimeoutMs'],9876)
        self.edit('claude', {'probe':server(8200)});self.converge()
        self.assertTrue(deepseek_rows(adapter.parse(adapter.path.read_bytes()))[0]['probe'][1]['disabled'])

    def test_old_removal_without_complete_fingerprints_stays_conflicted(self):
        self.edit('codex', {'probe':server()}); self.converge()
        value=dict(server(), enabled=True)
        self.sync.save({'version':3, 'base':{'probe':value}, 'pending':{'probe':{
            'before':{end:value for end in self.sync.adapters}, 'target':None}}})
        before={end:a.path.read_bytes() for end,a in self.sync.adapters.items()}
        self.assertIn('probe', self.sync.run()['conflicts'])
        self.assertEqual({end:a.path.read_bytes() for end,a in self.sync.adapters.items()}, before)
        self.assertIn('probe', self.sync.load()['pending'])
