// Browser acceptance only. The dev server permits this solely in an in-memory database.
export function seedMonitorUiFixture(db){
 const s=db.sqlite,at=new Date(Date.now()-60000).toISOString();
 s.prepare("INSERT INTO line_connections(id,operator_id,provider_id,channel_id,destination,name,enabled) VALUES('monitor-ui-oa','op-a','fixture-provider','fixture-channel','fixture-destination','監控驗收 OA（虛構）',0)").run();
 s.prepare("INSERT INTO monitor_groups(id,operator_id,connection_id,source_type,source_id,name,enabled,created_at,last_event_at) VALUES('monitor-ui-group','op-a','monitor-ui-oa','group','fixture-group','借址需求測試群組（虛構）',0,?,?)").run(at,at);
 // Historical message from an earlier fictional enabled session; the group is currently paused.
 s.prepare("INSERT INTO monitor_group_messages(id,operator_id,group_id,connection_id,event_id,provider_message_id,member_hash,body,created_at) VALUES('monitor-ui-message','op-a','monitor-ui-group','monitor-ui-oa','fixture-event','fixture-message','fixture-member','虛構群組訊息：想辦借址登記年約，TEST-ONLY。',?)").run(at);
}
