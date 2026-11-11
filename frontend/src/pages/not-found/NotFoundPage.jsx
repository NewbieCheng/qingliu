import React from "react";
import { Link } from "@/shared/router/index.js";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { ArrowLeftIcon } from "@/shared/ui/icons.jsx";

export function NotFoundPage() {
  return (
    <main>
      <PageHeader
        title="这里没有可打开的工作底稿。"
        description="Link may have expired, or this account has no access."
        actions={
          <Link className="back" to="/">
            <ArrowLeftIcon />
            Back to customers
          </Link>
        }
      />
      <EmptyState title="检查地址后再试">
        <p>内部链接会保留登录状态；如需新建客户，请从客户档案页开始。</p>
      </EmptyState>
    </main>
  );
}
