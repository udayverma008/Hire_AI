(function(){
  async function request(path,options={}){
    const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})};
    const response=await fetch(path,{...options,headers,credentials:'same-origin'});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(payload.error||`Request failed (${response.status}).`);error.status=response.status;throw error;}
    return payload;
  }
  function dashboardFor(user){return user.role==='Recruiter'?'/client/pages/dashboard/recruiter.html':'/client/pages/dashboard/candidate.html';}
  async function updateNavigation(){
    const loginLinks=[...document.querySelectorAll('a[href*="/auth/login.html"],a[href$="login.html"]')];
    if(!loginLinks.length)return;
    try{const {user}=await request('/api/auth/me');loginLinks.forEach(link=>{link.textContent=user.name;link.href=dashboardFor(user);link.setAttribute('aria-label',`Signed in as ${user.name}`)});const actions=loginLinks[0].parentElement;actions?.querySelectorAll('a[href$="register.html"]').forEach(link=>link.hidden=true);if(actions&&!actions.querySelector('[data-logout]')){const logout=document.createElement('button');logout.type='button';logout.dataset.logout='';logout.className='text-button';logout.textContent='Log out';logout.addEventListener('click',async()=>{await request('/api/auth/logout',{method:'POST'});location.reload()});actions.append(logout)}}catch{}
  }
  window.hireAiApi={request,dashboardFor,updateNavigation};
  document.addEventListener('DOMContentLoaded',updateNavigation);
})();
