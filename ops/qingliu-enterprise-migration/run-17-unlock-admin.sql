UPDATE t_user SET failed_login_count=0, locked_until=NULL, updated_at=UTC_TIMESTAMP(3) WHERE user_id=27;
SELECT user_id,email,failed_login_count,locked_until FROM t_user WHERE user_id=27;
