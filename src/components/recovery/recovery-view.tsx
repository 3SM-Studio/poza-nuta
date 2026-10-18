'use client';
import {useEffect,useRef,useTransition} from 'react';
import {CircleAlert,RotateCw,WifiOff} from 'lucide-react';
import {recoveryCopy,type RecoveryKind} from '@/i18n/recovery-copy';
import {isLocale,type Locale} from '@/i18n/locale';
import styles from './recovery.module.css';

export function RecoveryView({locale,kind,retry,management=false,onLocaleChange,embedded=false}:{locale:Locale;kind:RecoveryKind;retry?:()=>void;management?:boolean;onLocaleChange?:(locale:Locale)=>void;embedded?:boolean}){
 const [pending,startTransition]=useTransition();
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[kind]);
 const copy=recoveryCopy[locale],state=copy.states[kind],Icon=kind==='offline'?WifiOff:CircleAlert;
 const Surface=embedded?'section':'main';
 return <Surface className={styles.page} aria-labelledby="recovery-title" data-recovery-kind={kind} lang={locale}>
  <header className={styles.header}><a href={management?'/dashboard':'/join'} className={styles.brand}>Kunestu</a>
   {onLocaleChange?<select className={styles.select} aria-label={copy.language} value={locale} onChange={e=>{if(isLocale(e.target.value))onLocaleChange(e.target.value);}}>
    <option value="pl">Polski</option><option value="en">English</option><option value="uk">Українська</option>
   </select>:null}
  </header>
  <section className={styles.content}>
   <Icon aria-hidden="true" className={styles.icon}/><h1 id="recovery-title" tabIndex={-1} ref={heading}>{state.title}</h1><p>{state.description}</p>
   <div className={styles.actions}>
    {retry&&kind!=='unauthorized'&&kind!=='forbidden'&&kind!=='not_found'?<button type="button" className={`${styles.action} ${styles.primary}`} disabled={pending} aria-busy={pending} onClick={()=>startTransition(retry)}><RotateCw size={18} aria-hidden="true"/>{copy.retry}</button>:null}
    {kind==='unauthorized'?<a className={`${styles.action} ${styles.primary}`} href="/sign-in">{copy.signIn}</a>:null}
    <a className={styles.action} href={management?'/dashboard':'/join'}>{management?copy.dashboard:copy.join}</a>
   </div>
  </section>
 </Surface>;
}
