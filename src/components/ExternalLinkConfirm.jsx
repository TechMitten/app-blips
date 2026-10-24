import { useExternalConfirm } from '../hooks/useExternalConfirm';

// Drop-in replacement for an external <a>. `why` is shown in the dialog.
export function ConfirmedLink({ href, site, why, className, children, ...rest }) {
  const { ask, dialog } = useExternalConfirm();
  return (
    <>
      <a
        {...rest}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={(event) => {
          event.preventDefault();
          ask({ url: href, site, why });
        }}
      >
        {children}
      </a>
      {dialog}
    </>
  );
}
