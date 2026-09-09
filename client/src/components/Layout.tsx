import { Outlet, useNavigate } from 'react-router-dom';
import { Settings, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const Layout = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Top header */}
      <header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center justify-between border-b border-border/50 bg-background/80 px-5 backdrop-blur">
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-primary" />
          <span className="text-base font-semibold">Heybox Archive</span>
        </div>
        <div className="flex w-full max-w-md items-center gap-3">
          <Input
            type="search"
            placeholder="搜索收藏..."
            className="h-9"
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                const target = e.currentTarget;
                const query = encodeURIComponent(target.value);
                navigate(`/?search=${query}`);
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/settings')}
            aria-label="设置"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main content below header */}
      <main className="flex-1 pt-14">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
