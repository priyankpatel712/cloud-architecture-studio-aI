import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { TopNav } from '@/components/layout/TopNav';

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <Sidebar />
      <MobileNav />
      <main className="flex min-h-screen flex-col pb-16 md:pb-0 md:pl-[72px]">
        <TopNav />
        <div className="flex-1 p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
