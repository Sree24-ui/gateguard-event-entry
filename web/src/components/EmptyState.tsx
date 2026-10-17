import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  body,
  action
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={28} strokeWidth={1.5} aria-hidden />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
