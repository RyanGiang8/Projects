(function(){
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav){
    toggle.addEventListener('click', function(){
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items = document.querySelectorAll('.reveal');
  if (reduceMotion){
    items.forEach(function(el){ el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting){
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    items.forEach(function(el){ io.observe(el); });
  }

  var form = document.getElementById('lead-form');
  if (form){
    var status = form.querySelector('.form-status');
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var name = document.getElementById('f-name').value.trim();
      var business = document.getElementById('f-business').value.trim();
      var contact = document.getElementById('f-contact').value.trim();
      var message = document.getElementById('f-message').value.trim();
      if (!name || !business || !contact){
        status.textContent = 'Please fill out every required field.';
        status.className = 'form-status error';
        return;
      }
      var subject = encodeURIComponent('Free mockup request from ' + name + ' (' + business + ')');
      var body = encodeURIComponent(
        'Name: ' + name + '\nBusiness: ' + business + '\nContact: ' + contact + '\n\n' + message
      );
      window.location.href = 'mailto:ryangiang288@gmail.com?subject=' + subject + '&body=' + body;
      status.textContent = 'Opening your email app to send this request…';
      status.className = 'form-status success';
    });
  }
})();
