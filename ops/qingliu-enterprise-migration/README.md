# 清流4账号迁入「清流运营」· 执行单

目标: 测试迁移+验证通过 → 同样上生产。伪造邮箱(`*.qingliu.local`, 纯登录凭证)
全程可回滚(备份表 `_bak_*_qlmig` 跑完前别删)。

## 测试环境(按顺序)

1. 跑 `00-B1-verify-test.sql`(只读), 确认: 4行全在 / tenant 0 / type 1 / status 1 /
   积分全0 / deepseek-flash有`task_type='page-ocr'`的定价行(记下provider_code)。
2. 跑 `01-workbench-test-migrate.sql`, 每条`ROW_COUNT`对上注释, 记下`new_tenant_id`。
3. `02-qingliu-test-migrate.sql` 第1行填入@T再整文件跑, ROW_COUNT对上。
4. 验证:
   - 控制台: 个人账户4人消失, 企业账户"清流运营"4人在, admin是管理员。
   - 清流**企业登录**: `admin@qingliu.local`+原密码, `/api/me`里
     `tenant_name`=清流运营; 另3个同样进; **个人登录**用这4邮箱必须失败(预期)。
   - 权限: admin看人员/审计; reviewer01能定稿; sales01只能到草稿。
5. 红灯 → `03-rollback.sql` 按注释分段回滚, 恢复后4人用旧凭证+个人登录。

## 建企业可走控制台(推荐, 二选一)

- 控制台→企业→「新建企业」, owner 填 `admin@qingliu.local`, 名称`清流运营`,
  code 建议 `qingliu-ops`。这一步自动把 admin 升为企业 owner(role 2),
  效果=01脚本第2+3a段。
- 但注意顺序: 必须**先跑 01 的第 1 段**(admin 换伪造邮箱), 否则控制台按
  邮箱找不到 owner(旧 `admin` 无效邮箱格式, 建号校验过不了)。
- 用控制台建完后, 01脚本跳过建企业句, 把输出的 tenant_id 填进 @T 跑剩下部分。
- 挪3人只能走 SQL(控制台「新建企业成员」=新建账号, 遇到已存在凭证直接
  报错, 搬不过去已核实)。不要用邀请流程, 同样会被`ErrCredentialExists`挡掉。

## 防误操作(每次连库先跑)

```sql
SELECT DATABASE(); -- 确认是测试库还是生产库, 再跑下面
```
脚本本身不分环境, 连错库=直接动生产。`01/02`开头都有备份表,
但备份只防逻辑错, 不防连错库。

## 生产环境(测试全绿后)

- 同样4个文件逐字跑(`tenant_code`同样`qingliu-ops`, 伪造邮箱完全相同,
  新@T回填02)。跑之前先全量备份`t_user/t_user_service/t_user_role`+
  清流`ql_users/ql_customers`。
- 生产如已有`qingliu-ops`企业(比如谁建过), 02/01改用现成id, 跳过建企业句。
- 生产切换当天: 本地 `frontend/.env.local` 的 `VITE_DEV_LOGIN_USERNAME`
  改成 `admin@qingliu.local`(密码不变), 否则dev预填旧账号登不进
  (dev直连生产后端; 测试迁移不影响dev)。

## A-track(PUT 404 + 默认deepseek-flash, 根因已实锤)

实测结论(118生产库直查):
- `PUT /api/v1/admin/route-chains` 路由存在(未登录调它回401而非404)。
- `t_ai_capability` 有`page-ocr`(已启用), 但`t_model_pricing` 里
  **没有任何`task_type='page-ocr'`的行**(现有只有
  chat/image-generation/lipsync/tts/voice-clone/web-fetch/web-search)。
- 后端`ApplyRouteChain`: 提交的候选**全部无启用定价行** →
  `ErrPricingNotFound` → **404"资源不存在**。选谁都404, 与模型无关。
- 副作用: 生产`page-ocr`现在根本无可用模型, 清流`task=page-ocr`也跑不通。

修复顺序(不用发版, 纯运营配置):
1. 先加定价行: 控制台模型广场/定价页给deepseek-flash(或同等视觉模型)
   加一行`task_type='page-ocr'`的**启用**定价(走页面, 不要手写INSERT;
   厂商Key池里要有Key, 否则还是missing)。
2. 再置顶: `PUT {"chain_code":"page-ocr",
   "steps":[{"provider_code":"<上步的厂商>","model_code":"deepseek-flash"}, ...兜底...]}`
   → 200, 首位即默认。
3. 清流传扫描件走`page-ocr`验证命中deepseek-flash。
发版只在`GET route-chains`看不到`page-ocr`时才需要(部署见后端仓
`docs/development/deployment.md`, 上线清单`testing-and-release.md`)。
