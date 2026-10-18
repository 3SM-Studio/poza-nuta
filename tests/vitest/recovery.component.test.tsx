// @vitest-environment jsdom
import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {RecoveryView} from '@/components/recovery/recovery-view';
import {recoveryCopy,type RecoveryKind} from '@/i18n/recovery-copy';
import type {Locale} from '@/i18n/locale';
describe('safe accessible recovery',()=>{
 for(const locale of ['pl','en','uk'] as Locale[])for(const kind of Object.keys(recoveryCopy.en.states) as RecoveryKind[])it(`${locale} ${kind} has actionable localized copy`,()=>{
  const retry=vi.fn();render(<RecoveryView locale={locale} kind={kind} retry={retry}/>);
  expect(screen.getByRole('heading',{level:1})).toHaveTextContent(recoveryCopy[locale].states[kind].title);
  expect(screen.getByRole('main')).toHaveAttribute('lang',locale);
  expect(screen.getByRole('link',{name:recoveryCopy[locale].join})).toHaveAttribute('href','/join');
  if(['not_found','unauthorized','forbidden'].includes(kind))expect(screen.queryByRole('button')).toBeNull();
  else{fireEvent.click(screen.getByRole('button',{name:recoveryCopy[locale].retry}));expect(retry).toHaveBeenCalledTimes(1);}
 });
 it('never offers a fake retry when no recovery callback exists',()=>{render(<RecoveryView locale="en" kind="unavailable"/>);expect(screen.queryByRole('button')).toBeNull();});
 it('session expiry links to real sign-in and does not retry a mutation automatically',()=>{const retry=vi.fn();render(<RecoveryView locale="uk" kind="unauthorized" retry={retry}/>);expect(screen.getByRole('link',{name:'Увійти'})).toHaveAttribute('href','/sign-in');expect(retry).not.toHaveBeenCalled();});
 it('provides all three language choices without relying on the failed provider',()=>{const change=vi.fn();render(<RecoveryView locale="en" kind="unexpected" onLocaleChange={change}/>);fireEvent.change(screen.getByRole('combobox'),{target:{value:'uk'}});expect(change).toHaveBeenCalledWith('uk');});
});
