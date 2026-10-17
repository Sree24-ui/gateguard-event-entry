import { Loader2 } from 'lucide-react';

export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="page-loader" role="status">
      <Loader2 size={20} className="spin" aria-hidden />
      <span className="stamp">{label}</span>
    </div>
  );
}
