"use client";

import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type ScrollAreaProps = React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string;
  viewportProps?: Omit<
    React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>,
    "children" | "className"
  >;
};

function ScrollArea({
  className,
  children,
  type = "auto",
  viewportClassName,
  viewportProps,
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type={type}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        tabIndex={0}
        {...viewportProps}
        className={cn(
          "size-full overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset [&>div]:!block",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        data-slot="scroll-area-scrollbar"
        orientation="vertical"
        className="group/scrollbar hidden h-full w-3 touch-none select-none flex-col items-end py-2 [--radix-scroll-area-thumb-width:3px] hover:[--radix-scroll-area-thumb-width:6px] pointer-fine:flex"
      >
        <ScrollAreaPrimitive.Thumb
          data-slot="scroll-area-thumb"
          className="rounded-full bg-sidebar-foreground/20 transition-[width,background-color] duration-150 group-hover/scrollbar:bg-sidebar-foreground/30"
        />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

export { ScrollArea };
