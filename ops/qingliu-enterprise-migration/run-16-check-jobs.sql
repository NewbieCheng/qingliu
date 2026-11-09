SELECT j.id,j.user_id,u.username,j.kind,j.status FROM qingliu.ql_jobs j LEFT JOIN qingliu.ql_users u ON u.id=j.user_id WHERE j.status IN ('queued','running','failed') ORDER BY j.created DESC LIMIT 5;
