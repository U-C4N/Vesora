import {useId} from 'react';

/** The repository's existing Vesora mark, also used by docs/assets/vesora-banner.svg. */
export function VesoraMark({size = 32, className, title}: {size?: number; className?: string; title?: string}) {
  const id = useId();
  return <svg width={size} height={size} viewBox="0 0 40 40" className={className} fill="none" role={title ? 'img' : undefined} aria-labelledby={title ? id : undefined} aria-hidden={title ? undefined : true}>
    {title && <title id={id}>{title}</title>}
    <path d="M4 9.5h9.1l10.5 20.8-5.4 5.2L4 9.5Z" fill="currentColor" />
    <path d="m14.5 4.5 7.6 2.4 5.6 12.7-4.1 10.7L14.5 4.5Z" fill="currentColor" opacity=".62" />
    <path d="M26.4 7.8 36 4.5 23.6 30.3l-5.4 5.2 8.2-27.7Z" fill="currentColor" />
  </svg>;
}
