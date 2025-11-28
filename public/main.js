async function postJSON(url, data){
  const res = await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(data)
  });
  const text = await res.text();
  let json; try{ json = JSON.parse(text) }catch{ json = {raw:text} }
  return { ok: res.ok, status: res.status, data: json };
}

function $(sel){ return document.querySelector(sel) }

function setAuthed(email){
  if (email) localStorage.setItem('email', email);
  const e = localStorage.getItem('email');
  const authed = !!e;
  const authedEls = document.querySelectorAll('[data-authed]');
  const anonEls   = document.querySelectorAll('[data-anon]');
  authedEls.forEach(n=>n.classList.toggle('hidden', !authed));
  anonEls.forEach(n=>n.classList.toggle('hidden', authed));
  const span = $('#whoami'); if (span) span.textContent = e || '';
}

document.addEventListener('DOMContentLoaded', () => {
  setAuthed();

  // Login form
  const loginForm = $('#loginForm');
  if (loginForm){
    loginForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = e.target.email.value.trim();
      const password = e.target.password.value;
      const out = $('#loginMsg');
      out.textContent = '… logging in';
      const r = await postJSON('/login',{email,password});
      if (r.ok){
        setAuthed(email);
        out.textContent = '✅ Logged in';
        setTimeout(()=>location.href='/', 400);
      } else {
        out.textContent = `❌ ${r.data?.error||'login failed'} (status ${r.status})`;
      }
    });
  }

  // Register form (on the same page)
  const regForm = $('#registerForm');
  if (regForm){
    regForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = e.target.email.value.trim();
      const password = e.target.password.value;
      const out = $('#registerMsg');
      out.textContent = '… creating account';
      const r = await postJSON('/register',{email,password});
      if (r.ok){
        out.textContent = '✅ Account created — you can log in now';
      } else {
        out.textContent = `❌ ${r.data?.error||'register failed'} (status ${r.status})`;
      }
    });
  }

  // Logout button on index
  const logoutBtn = $('#logout');
  if (logoutBtn){
    logoutBtn.addEventListener('click', ()=>{
      localStorage.removeItem('email');
      setAuthed();
    });
  }
});
