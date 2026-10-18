import {RecoveryBoundary} from '@/components/recovery/recovery-boundary';
export function AdminAccessDenied(){return <div data-admin-access-denied="true" data-management-theme="true"><RecoveryBoundary kind="forbidden"/></div>;}
