const registerForm=document.getElementById('registerForm');
if(registerForm)registerForm.addEventListener('submit',async event=>{
  event.preventDefault();const status=registerForm.querySelector('[role=status]'),button=registerForm.querySelector('[type=submit]');
  status.textContent='Creating your account…';button.disabled=true;
  try{const payload=await window.hireAiApi.request('/api/auth/register',{method:'POST',body:JSON.stringify({name:registerForm.elements.name.value,email:registerForm.elements.email.value,password:registerForm.elements.password.value,role:registerForm.elements.role.value})});status.textContent='Account created. Opening your dashboard…';location.href=window.hireAiApi.dashboardFor(payload.user)}catch(error){status.textContent=error.message;button.disabled=false}
});
const loginForm=document.getElementById('loginForm');
if(loginForm)loginForm.addEventListener('submit',async event=>{
  event.preventDefault();const message=document.getElementById('message'),button=loginForm.querySelector('[type=submit]');message.textContent='Signing in…';button.disabled=true;
  try{const payload=await window.hireAiApi.request('/api/auth/login',{method:'POST',body:JSON.stringify({email:document.getElementById('email').value.trim(),password:document.getElementById('password').value})});message.textContent='Signed in. Opening your dashboard…';location.href=window.hireAiApi.dashboardFor(payload.user)}catch(error){message.textContent=error.message;button.disabled=false}
});
