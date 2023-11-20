document.getElementById('registrationForm').addEventListener('submit', function (event) {
    event.preventDefault(); // Prevent the default form submission

    const formData = new FormData(event.target);

    fetch('/register', {
        method: 'POST',
        body: formData,
    })
    .then(response => response.json())
    .then(data => {
        // Update the messageContainer with the response
        document.getElementById('messageContainer').innerHTML = data.message || data.error || '';
    })
    .catch(error => {
        console.error('Error during registration:', error);
        // Update the messageContainer with the error message
        document.getElementById('messageContainer').innerHTML = 'Error during registration: ' + error.message;
    });

    return false; // Prevent the default form submission
});
