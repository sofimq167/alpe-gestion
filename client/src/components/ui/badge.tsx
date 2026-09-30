import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', {
  variants: {
    variant: {
      default: 'bg-accent text-accent-foreground ring-primary/15',
      neutral: 'bg-muted text-muted-foreground ring-border',
      success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
      warning: 'bg-amber-50 text-amber-800 ring-amber-600/25',
      danger: 'bg-red-50 text-red-700 ring-red-600/20',
      info: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;
