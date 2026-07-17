"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  MenuIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { AdminActorViewModel } from "@/server/platform-admin/page-access-core";

import { AdminThemeSwitcher } from "./admin-theme-switcher";

type AdminShellProps = {
  actor: AdminActorViewModel;
  children: ReactNode;
};

const roleLabels = {
  platform_owner: "Właściciel platformy",
  platform_admin: "Administrator platformy",
  support: "Wsparcie",
} as const;

export function AdminShell({ actor, children }: AdminShellProps) {
  const pathname = usePathname();
  const currentPage = pathname === "/admin/imports" ? "Importy" : "Overview";

  return (
    <div
      data-admin-shell="true"
      data-management-theme="true"
      className="min-h-screen overflow-x-hidden bg-background text-foreground"
    >
      <a
        href="#admin-main"
        className="sr-only z-[70] rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Przejdź do treści
      </a>

      <div className="grid min-h-screen lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          className="sticky top-0 hidden h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex"
          aria-label="Nawigacja administratora"
        >
          <div className="flex min-h-20 flex-col justify-center border-b border-sidebar-border px-5">
            <span className="text-base font-semibold">Poza Nutą</span>
            <span className="text-xs text-muted-foreground">Administracja</span>
          </div>
          <AdminNavigation pathname={pathname} />
          <div className="mt-auto p-4">
            <ActorSummary actor={actor} />
            <Separator className="my-4" />
            <Button variant="ghost" className="h-11 w-full justify-start" asChild>
              <Link href="/dashboard">
                <ArrowLeftIcon />
                Panel organizatora
              </Link>
            </Button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-40 flex min-h-16 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur sm:px-5">
            <MobileNavigation actor={actor} />
            <div className="min-w-0 flex-1">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>{currentPage}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              <span className="max-w-44 truncate text-sm font-medium">
                {actor.displayName}
              </span>
              <Badge variant="secondary">{roleLabels[actor.role]}</Badge>
            </div>
            <AdminThemeSwitcher />
          </header>

          <main id="admin-main" className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

const adminNavigationItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/admin/imports", label: "Importy", icon: DatabaseIcon },
] as const;

function AdminNavigation({
  mobile = false,
  pathname,
}: {
  mobile?: boolean;
  pathname: string;
}) {

  return (
    <nav
      className="grid gap-1 p-4"
      aria-label={mobile ? "Mobilna administracja platformą" : "Administracja platformą"}
    >
      {adminNavigationItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        const link = (
          <Button
            variant="ghost"
            className={`h-11 w-full justify-start ${
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground"
            }`}
            asChild
          >
            <Link href={href} aria-current={active ? "page" : undefined}>
              <Icon />
              {label}
            </Link>
          </Button>
        );

        return mobile ? (
          <SheetClose asChild key={href}>
            {link}
          </SheetClose>
        ) : (
          <div key={href}>{link}</div>
        );
      })}
    </nav>
  );
}

function MobileNavigation({ actor }: { actor: AdminActorViewModel }) {
  const pathname = usePathname();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 lg:hidden"
          aria-label="Otwórz menu administratora"
        >
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" data-management-theme="true">
        <SheetHeader>
          <SheetTitle>Poza Nutą</SheetTitle>
          <SheetDescription>Administracja platformą</SheetDescription>
        </SheetHeader>
        <AdminNavigation mobile pathname={pathname} />
        <div className="mt-auto">
          <ActorSummary actor={actor} />
          <Separator className="my-4" />
          <SheetClose asChild>
            <Button variant="ghost" className="h-11 w-full justify-start" asChild>
              <Link href="/dashboard">
                <ArrowLeftIcon />
                Panel organizatora
              </Link>
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ActorSummary({ actor }: { actor: AdminActorViewModel }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar size="lg">
        <AvatarFallback>{actor.initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-semibold">{actor.displayName}</p>
        <Badge variant="secondary" className="mt-1 max-w-full">
          {roleLabels[actor.role]}
        </Badge>
      </div>
    </div>
  );
}
