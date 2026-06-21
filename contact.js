/* Shared contact modal + form handling for index.html and about.html.
   This is a static site with no backend, so submissions work two ways:
   1. If FORMSPREE_ENDPOINT below is set to a real Formspree form URL,
      the message is submitted in-page (no email client popup) and a
      success message is shown without leaving the page.
   2. Until then (or if that request fails), it falls back to opening
      the visitor's email client with the message pre-filled via mailto:.
   Sign up free at https://formspree.io, create a form, and paste its
   endpoint below to switch from the mailto fallback to true in-page
   submission. */

const CONTACT_EMAIL = 'ryangiang288@gmail.com';
const FORMSPREE_ENDPOINT = ''; // e.g. 'https://formspree.io/f/abcd1234'

function initContactModal(){
  const modal = document.getElementById('contactModal');
  const openTriggers = document.querySelectorAll('[data-open-contact]');
  const closeBtn = document.getElementById('contactClose');
  const form = document.getElementById('contactForm');
  const status = document.getElementById('cf-status');
  const submitBtn = document.getElementById('cf-submit');

  if (!modal || !form) return;

  function openModal(e){
    if (e) e.preventDefault();
    modal.classList.add('open');
    document.getElementById('cf-name')?.focus();
  }
  function closeModal(){
    modal.classList.remove('open');
  }

  openTriggers.forEach(el => el.addEventListener('click', openModal));
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  });

  function sendViaMailto(name, email, message){
    const subject = encodeURIComponent(`Portfolio inquiry from ${name}`);
    const body = encodeURIComponent(`${message}\n\n— ${name} (${email})`);
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cf-name').value.trim();
    const email = document.getElementById('cf-email').value.trim();
    const message = document.getElementById('cf-message').value.trim();

    if (!name || !email || !message){
      status.textContent = 'Please fill out every field.';
      status.className = 'form-status error';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    status.textContent = '';
    status.className = 'form-status';

    if (FORMSPREE_ENDPOINT){
      try {
        const res = await fetch(FORMSPREE_ENDPOINT, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: new FormData(form)
        });
        if (res.ok){
          status.textContent = "Thanks — your message was sent. I'll get back to you soon.";
          status.className = 'form-status success';
          form.reset();
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Message';
          return;
        }
        throw new Error('Form submission failed');
      } catch (err) {
        // fall through to mailto fallback below
      }
    }

    sendViaMailto(name, email, message);
    status.textContent = 'Opening your email app to send this message…';
    status.className = 'form-status success';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Message';
  });
}

document.addEventListener('DOMContentLoaded', initContactModal);
