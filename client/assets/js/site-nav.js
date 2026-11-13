(() => {
  const nav = document.querySelector('.header .nav');
  if (!nav) return;
  const nestedPage = location.pathname.includes('/pages/');
  const base = nestedPage ? '../../' : '';
  const href = path => `${base}${path}`;
  nav.innerHTML = `
    <a class="logo" href="${href('index.html')}" aria-label="HireAI home"><b>H</b> Hire<span>AI</span></a>
    <button class="menu" id="menu" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="siteLinks">☰</button>
    <div class="links" id="siteLinks">
      <a href="${href('index.html')}">Home</a>
      <a href="${href('pages/jobs/jobs.html')}">Find Jobs</a>
      <a href="${href('pages/tools/resume-builder.html')}">Resume Builder</a>
      <a href="${href('pages/tools/ai-career.html')}">Career AI</a>
      <a data-dashboard-link href="${href('pages/dashboard/candidate.html')}">Dashboard</a>
      <a href="${href('index.html')}#about">About</a>
    </div>
    <div class="actions">
      <a href="${href('pages/auth/login.html')}">Log in</a>
      <a class="btn small" href="${href('pages/auth/register.html')}">Get started ↗</a>
    </div>`;
  const menu = nav.querySelector('#menu'), links = nav.querySelector('#siteLinks');
  menu.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  links.querySelectorAll('a').forEach(link => {
    const target = new URL(link.href, location.href);
    if (target.pathname === location.pathname) link.classList.add('selected');
    link.addEventListener('click', () => {
      links.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-label', 'Open navigation');
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      links.classList.remove('open');
      menu.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-label', 'Open navigation');
    }
  });
})();
