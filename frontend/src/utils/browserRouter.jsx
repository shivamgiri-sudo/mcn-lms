import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const RouterContext = createContext(null);

function currentLocation() {
  return {
    pathname: window.location.pathname || '/',
    search: window.location.search || '',
    hash: window.location.hash || '',
  };
}

function routeMatches(pattern, pathname) {
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return pathname === base || pathname.startsWith(`${base}/`);
  }
  return pattern === pathname;
}

function navigateTo(to, { replace = false } = {}) {
  const target = String(to || '/');
  if (replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function BrowserRouter({ children }) {
  const [location, setLocation] = useState(currentLocation);

  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  const value = useMemo(() => ({ location, navigate: navigateTo }), [location]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useLocation() {
  const context = useContext(RouterContext);
  if (!context) throw new Error('useLocation must be used inside BrowserRouter.');
  return context.location;
}

export function useSearchParams() {
  const context = useContext(RouterContext);
  if (!context) throw new Error('useSearchParams must be used inside BrowserRouter.');
  const { location, navigate } = context;
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  function setParams(nextParams, options = {}) {
    const search = nextParams instanceof URLSearchParams
      ? nextParams.toString()
      : new URLSearchParams(nextParams).toString();
    navigate(`${location.pathname}${search ? `?${search}` : ''}${location.hash}`, options);
  }
  return [params, setParams];
}

export function Navigate({ to, replace = false }) {
  useEffect(() => navigateTo(to, { replace }), [to, replace]);
  return null;
}

export function Link({ to, replace = false, onClick, children, ...props }) {
  function handleClick(event) {
    onClick?.(event);
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.altKey
      || event.ctrlKey
      || event.shiftKey
      || props.target
    ) return;
    event.preventDefault();
    navigateTo(to, { replace });
  }
  return <a {...props} href={to} onClick={handleClick}>{children}</a>;
}

export function Route() {
  return null;
}

export function Routes({ children }) {
  const context = useContext(RouterContext);
  if (!context) throw new Error('Routes must be used inside BrowserRouter.');
  const routes = React.Children.toArray(children);
  const match = routes.find(route => routeMatches(route.props.path, context.location.pathname));
  return match?.props.element || null;
}
