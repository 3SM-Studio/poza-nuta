'use client';
import {useLocale} from 'next-intl';
import {usePathname,useRouter} from 'next/navigation';
import {useSyncExternalStore} from 'react';
import {isLocale,isManagementPath,localeCookie,resolveLocale,type Locale} from '@/i18n/locale';
import {type RecoveryKind,recoveryCopy} from '@/i18n/recovery-copy';
import {RecoveryView} from './recovery-view';
import styles from './recovery.module.css';

function subscribeOnline(notify:()=>void){window.addEventListener('online',notify);window.addEventListener('offline',notify);return()=>{window.removeEventListener('online',notify);window.removeEventListener('offline',notify);};}
const online=()=>navigator.onLine;
const serverOnline=()=>true;
export function useOnline(){return useSyncExternalStore(subscribeOnline,online,serverOnline);}
function saveLocale(locale:Locale){document.cookie=`${localeCookie}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;}

export function RecoveryBoundary({kind='unexpected',retry,embedded=false}:{kind?:RecoveryKind;retry?:()=>void;embedded?:boolean}){
 const selected=useLocale(),router=useRouter(),pathname=usePathname(),connected=useOnline();
 const fallback=isLocale(selected)?selected:'en';
 const locale=useSyncExternalStore(subscribeLocale,()=>storedLocale(fallback),()=>fallback);
 return <RecoveryView embedded={embedded} locale={locale} kind={!connected&&(kind==='unexpected'||kind==='unavailable')?'offline':kind} management={isManagementPath(pathname??'/')} retry={retry??(()=>router.refresh())} onLocaleChange={l=>{saveLocale(l);window.dispatchEvent(new Event('kunestu-recovery-locale'));router.refresh();}}/>;
}

export function OfflineNotice(){const locale=useLocale(),connected=useOnline();return connected?null:<aside className={styles.notice} role="status" data-offline-notice>{recoveryCopy[isLocale(locale)?locale:'en'].offlineNotice}</aside>;}

// Provider-independent fallback for a failed root layout. Never read auth storage.
function browserLocale(fallback:Locale='en'){const value=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(localeCookie+'='))?.slice(localeCookie.length+1);return resolveLocale(value,navigator.languages.join(','),fallback);}
function storedLocale(fallback:Locale){const value=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(localeCookie+'='))?.slice(localeCookie.length+1);return isLocale(value)?value:fallback;}
function subscribeLocale(notify:()=>void){window.addEventListener('languagechange',notify);window.addEventListener('kunestu-recovery-locale',notify);return()=>{window.removeEventListener('languagechange',notify);window.removeEventListener('kunestu-recovery-locale',notify);};}
const serverLocale=():Locale=>'en';
const browserManagement=()=>isManagementPath(window.location.pathname);
const serverManagement=()=>false;
export function StandaloneRecovery({retry}:{retry:()=>void}){const locale=useSyncExternalStore(subscribeLocale,()=>browserLocale(browserManagement()?'pl':'en'),serverLocale),connected=useOnline(),management=useSyncExternalStore(subscribeLocale,browserManagement,serverManagement);return <html lang={locale}><body style={{margin:0}}><title>Kunestu</title><RecoveryView locale={locale} management={management} kind={connected?'unexpected':'offline'} retry={retry} onLocaleChange={l=>{saveLocale(l);window.dispatchEvent(new Event('kunestu-recovery-locale'));}}/></body></html>;}
