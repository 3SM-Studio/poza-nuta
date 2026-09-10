import type { LucideIcon } from "lucide-react";

export type AppNavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

export type AppNavigationGroup = {
  label: string;
  ariaLabel?: string;
  hideLabel?: boolean;
  items: AppNavigationItem[];
};

export function getActiveNavigationHref(
  pathname: string,
  groups: AppNavigationGroup[],
) {
  const currentPath = normalizePath(pathname);

  return groups
    .flatMap((group) => group.items)
    .filter((item) => {
      const href = normalizePath(item.href);
      return item.exact
        ? currentPath === href
        : currentPath === href || currentPath.startsWith(`${href}/`);
    })
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}

function normalizePath(path: string) {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}
