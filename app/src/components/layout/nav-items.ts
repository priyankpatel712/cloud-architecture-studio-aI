import { Home, Layers, Workflow, Plug, type LucideIcon } from 'lucide-react';

export const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/projects', label: 'Projects', icon: Layers },
  { href: '/studio', label: 'Studio', icon: Workflow },
  { href: '/connections', label: 'Connections', icon: Plug },
];

export function isNavActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}
