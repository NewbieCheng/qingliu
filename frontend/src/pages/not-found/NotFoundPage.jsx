import React from "react";
import { Link } from "@/shared/router/index.js";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";

export function NotFoundPage() {
  return (
    <main>
      <PageHeader
        eyebrow="页面不存在"
        title="这里没有可打开的工作底稿。"
        description="链接可能已失效，或当前账号没有访问权限。"
        actions={
          <Link className="button-link" to="/">
            返回客户档案
          </Link>
        }
      />
      <EmptyState title="检查地址后再试">
        <p>内部链接会保留登录状态；如需新建客户，请从客户档案页开始。</p>
      </EmptyState>
    </main>
  );
}
