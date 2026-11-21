/** Shows the error message after a failed login (?error=1). */
const error = document.getElementById('login-error');
if (error && new URLSearchParams(window.location.search).get('error') === '1') {
  error.hidden = false;
}
