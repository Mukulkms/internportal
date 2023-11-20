const express = require('express');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const puppeteer = require('puppeteer');
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const mysql = require('mysql');
const bcrypt = require('bcrypt');
const session = require('express-session');
const bodyParser = require('body-parser');
const app = express();
const pdf = require('html-pdf');
const port = 3000;

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));


function formatDate(dateString) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const formattedDate = new Date(dateString).toLocaleDateString(undefined, options);
  return formattedDate;
}


// Create MySQL connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'mydatabase'
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error('MySQL connection error:', err);
  } else {
    console.log('Connected to MySQL');
  }
});

// Middleware to parse JSON and URL-encoded form data
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));


// Set up sessions
app.use(session({
  secret: 'your_secret_key',
  resave: true,
  saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Login route
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const getUserQuery = 'SELECT * FROM user WHERE username = ?';
  db.query(getUserQuery, [username], async (getErr, getResult) => {
    if (getErr) {
      console.error('Error retrieving user:', getErr);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (getResult.length > 0) {
      // User found, check password
      const storedPassword = getResult[0].password;

      try {
        const passwordMatch = await bcrypt.compare(password, storedPassword);

        if (passwordMatch) {
          // Set the user ID in the session upon successful login
          req.session.userId = getResult[0].id;

          console.log('Login successful');
          return res.status(200).json({ message: 'Login successful' });
        } else {
          // Incorrect password
          return res.status(401).json({ error: 'Incorrect password' });
        }
      } catch (compareError) {
        console.error('Error comparing passwords:', compareError);
        return res.status(500).json({ error: 'Internal Server Error' });
      }
    } else {
      // User not found
      return res.status(404).json({ error: 'User not found' });
    }
  });
});



// Middleware to check if the user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    // User is authenticated, proceed to the next middleware
    return next();
  } else {
    // User is not authenticated, redirect to login page
    res.redirect('/login.html');
  }
};

app.get('/checkAuthentication', (req, res) => {
  // Check if the user is authenticated
  if (req.session.userId) {
    // User is authenticated
    res.sendStatus(200);
  } else {
    // User is not authenticated
    res.sendStatus(401);
  }
});

// Registration route
app.post('/register', isAuthenticated, async (req, res) => {
  const { username, password, email } = req.body;

  const checkUserQuery = 'SELECT * FROM user WHERE username = ?';
  db.query(checkUserQuery, [username], async (checkErr, checkResult) => {
    if (checkErr) {
      console.error('Error checking existing user:', checkErr);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      if (checkResult.length > 0) {
        // Username already exists
        res.status(409).json({ error: 'Username already exists' });
      } else {
        // Username doesn't exist, proceed with registration
        try {
          const hashedPassword = await bcrypt.hash(password, 10);

          const insertQuery = 'INSERT INTO user (username, password, email) VALUES (?, ?, ?)';
          db.query(insertQuery, [username, hashedPassword, email], (insertErr, insertResult) => {
            if (insertErr) {
              console.error('Error inserting user:', insertErr);
              res.status(500).json({ error: 'Internal Server Error' });
            } else {
              console.log('User registered successfully');
              res.status(200).json({ message: 'Registration successful' });
            }
          });
        } catch (hashError) {
          console.error('Error hashing password:', hashError);
          res.status(500).json({ error: 'Internal Server Error' });
        }
      }
    }
  });
});


// Dashboard route to fetch dashboard data
app.get('/dashboardData', (req, res) => {
  // Check if the user is logged in (you might have a more robust check)
  if (!req.session.userId) {
    res.status(401).json({ error: 'User not logged in' });
    return;
  }

  const loggedInUserId = req.session.userId;

  const getUserQuery = 'SELECT * FROM user WHERE id = ?';
  db.query(getUserQuery, [loggedInUserId], (getUserErr, getUserResult) => {
    if (getUserErr) {
      console.error('Error getting user data:', getUserErr);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      const userData = getUserResult[0]; // Assuming you only expect one user with the given ID

      // Set no-cache headers
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Expires', '-1');
      res.setHeader('Pragma', 'no-cache');

      // Send JSON response with user data
      res.json({ userData });
    }
  });
});


// Logout route
app.get('/logout', (req, res) => {
  // Destroy the session
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      // Redirect to the login page after session destruction
      res.redirect('/login.html');
    }
  });
});
// Registered Interns route
app.get('/registeredInternsData', isAuthenticated, (req, res) => {
  // Fetch data from the intern_registration table
  const getInternsQuery = 'SELECT * FROM intern_registration';
  db.query(getInternsQuery, (getInternsErr, getInternsResult) => {
    if (getInternsErr) {
      console.error('Error getting interns data:', getInternsErr);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      const internsData = getInternsResult.map(intern => ({
        ...intern,
        dateOfJoining: formatDateInUTC(intern.dateOfJoining),
        dateofcompletion: formatDateInUTC(intern.dateofcompletion),
      }));
      res.json({ internsData });
    }
  });
});

function formatDateInUTC(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return '';
  }

  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = (date.getUTCDate() + 1).toString().padStart(2, '0');
  
  return `${year}-${month}-${day}`;
  
}




// intern registration route
app.post('/internRegistration', (req, res) => {
  const {
    fullName,
    email,
    phone,
    collegeName,
    highestQualification,
    internshipDomain,
    duration,
    customDuration, // Add customDuration to the request body
    dateOfJoining, 
    dateofcompletion,
  } = req.body;

  console.log('Received form data:', req.body);
  
  const insertQuery = `
    INSERT INTO intern_registration
    (fullname, email, phone, collegename, highestqualification, internshipdomain, duration, custom_duration, dateOfJoining, dateofcompletion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    insertQuery,
    [fullName, email, phone, collegeName, highestQualification, internshipDomain, duration, customDuration, dateOfJoining, dateofcompletion],
    (insertErr, insertResult) => {
      if (insertErr) {
        console.error('Error during intern registration:', insertErr);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        console.log('Intern registration successful');
        res.status(200).json({ message: 'Intern registration successful' });
      }
    }
  );
});




// Fetch individual intern data based on ID
app.get('/internData', (req, res) => {
  const internId = req.query.id;

  if (!internId) {
    res.status(400).json({ error: 'Missing intern ID' });
    return;
  }

  const getInternQuery = 'SELECT * FROM intern_registration WHERE id = ?';
  db.query(getInternQuery, [internId], (getInternErr, getInternResult) => {
    if (getInternErr) {
      console.error('Error getting intern data:', getInternErr);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      if (getInternResult.length > 0) {
        const internData = getInternResult[0];
        res.json({ success: true, internData });
      } else {
        res.json({ success: false, message: 'Intern not found' });
      }
    }
  });
});

// Update intern data route
app.post('/updateInternData', (req, res) => {
  const {
    id, 
    fullName,
    email,
    phone,
    collegeName,
    highestQualification,
    internshipDomain,
    duration,
    customDuration,
    dateOfJoining,
    dateofcompletion 
  } = req.body;

  const updateQuery = `
    UPDATE intern_registration
    SET
      fullname = ?,
      email = ?,
      phone = ?,
      collegename = ?,
      highestqualification = ?,
      internshipdomain = ?,
      duration = ?,
      custom_duration = ?,
      dateOfJoining = ?,
      dateofcompletion = ? 
    WHERE
      id = ?
  `;

  db.query(
    updateQuery,
    [fullName, email, phone, collegeName, highestQualification, internshipDomain, duration, customDuration, dateOfJoining, dateofcompletion, id], // Add id here
    (updateErr, updateResult) => {
      if (updateErr) {
        console.error('Error during intern update:', updateErr);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        console.log('Intern data updated successfully');
        res.status(200).json({ message: 'Intern data updated successfully' });
      }
    }
  );
});



// Get the absolute path to the base.txt file
const basePath = path.join(__dirname, 'public/images');
const base64ImagePath = path.join(basePath, 'base64.txt');

// Read the base64-encoded image from the file
const base64Image = fs.readFileSync(base64ImagePath, 'utf8');

app.post('/generateOfferLetter/:id', async (req, res) => {
  const internId = req.params.id;

  // Fetch intern data based on ID from the database
  const getInternQuery = 'SELECT * FROM intern_registration WHERE id = ?';
  db.query(getInternQuery, [internId], async (getInternErr, getInternResult) => {
    if (getInternErr) {
      console.error('Error getting intern data for offer letter:', getInternErr);
      res.status(500).json({ error: 'Internal Server Error' });
    } else {
      if (getInternResult.length > 0) {
        const internData = getInternResult[0];

        // Construct HTML content based on your data
        const htmlContent = `
        <html>
        <head>
          <style>
          body{
            padding:1rem 2rem;
            background-size: cover;
            background-image: url('data:image/png;base64,${base64Image}');
            
          }
            h1{
              text-align:center;
              padding:2rem 0;
              font-family:sans-serif;
            }
            p{font-size:18px;
              font-family:sans-serif;
              line-height:1.8rem;
              padding:0 1rem;
            }
            
          </style>
    
        </head>
        <body>
          <h1>Offer Letter</h1>
          <div class="container">
          <p>Dear <strong>${internData.fullname},</strong></p>
          <p>We are pleased to inform you that you have been selected for the <strong> ${internData.internshipdomain} </strong> Internship program at Suvidha Foundation (Suvidha Mahila Mandal). Congratulations on this significant achievement!</p>
          <p>Suvidha Foundation, established in 1995, is dedicated to Women's empowerment, Environmental protection, and Girl Child Education. Your exceptional qualifications and demonstrated passion for <strong>"${internData.internshipdomain}"</strong> have made you an outstanding candidate for our program, and we firmly believe that your contributions will significantly benefit our team.</p>
          <p>The internship is scheduled to start <strong> ${formatDate(internData.dateOfJoining)} </strong> and will last for <strong> ${formatDate(internData.dateofcompletion)} </strong>. During this period, you will have the opportunity to work closely with our experienced team and gain hands-on experience in Web Development and Social Campaigns.</p>
          <p>Please consider this as your official offer letter. Read the detailed information about the internship program given below, which includes the terms and conditions. Kindly review the details thoroughly and confirm your acceptance by replying to this email.</p>
          <p><strong>Internship Details:</strong></p>
          <p><strong>Domain:</strong> <strong>${internData.internshipdomain}</strong></p>
          <p><strong>Responsibilities:</strong></p>
          <ol>
            <li>Work on the assigned project given by the mentor.</li>
            <li>Assist in fundraising towards "Tree Plantation" and "Girl Child Education" programs, particularly in thermal power-affected areas.</li>
          </ol>
          <p><strong>Deliverables:</strong></p>
          <ol>
            <li>Completion certificate upon successfully fulfilling your responsibilities.</li>
            <li>Letter of Recommendation for outstanding work, based on mentor feedback.</li>
          </ol>
          <p>Should you have any queries or require further information, please do not hesitate to reach out.</p>
          <p>We are eagerly looking forward to welcoming you to the Suvidha Foundation team and are excited about the significant contributions you will make during your tenure with us.</p>
          <p><strong>Best regards,</strong></p>
          <p>Ms. Sonal Godshelwar,</p>
          <br><br>
          <p>HR, Suvidha Foundation (Suvidha Mahila Mandal)</p>
          <p><a href="http://www.suvidhafoundationedutech.org">www.suvidhafoundationedutech.org</a></p>
          <p><a href="https://www.linkedin.com/company/suvidha-foundation/">https://www.linkedin.com/company/suvidha-foundation/</a></p>
          </div>
          </body>
      </html>
        `;

       // Set options for html-pdf
       const pdfOptions = {
        format: 'Letter',
      };

      // Generate PDF
      pdf.create(htmlContent, pdfOptions).toBuffer((pdfErr, pdfBuffer) => {
        if (pdfErr) {
          console.error('Error generating PDF:', pdfErr);
          res.status(500).json({ error: 'Internal Server Error' });
        } else {
          // Set the Content-Type header
          res.setHeader('Content-Type', 'application/pdf');

          // Send the PDF as a downloadable file to the client
          res.send(pdfBuffer);
        }
      });
    } else {
      res.status(404).json({ error: 'Intern not found' });
    }
  }
});
});


app.post('/sendOfferLetterEmail', (req, res) => {
  const { internEmail, fileName, offerLetterBlob } = req.body;

  if (!internEmail) {
    return res.status(400).json({ error: 'Recipient email not provided' });
  }

  try {
    // Ensure offerLetterBlob is a base64-encoded string
    const buffer = Buffer.from(offerLetterBlob, 'base64');

    // Create a Nodemailer transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'mukulkms@gmail.com', // Replace with your Gmail email
        pass: 'hdvy hlzn kxdx gjiu',    // Replace with your App Password
      },
    });

    // Setup email options
    const mailOptions = {
      from: 'mukulkms@gmail.com',
      to: internEmail,
      subject: 'Offer Letter',
      text: 'Please find the attached offer letter.',
      attachments: [
        {
          filename: fileName,
          content: buffer, // Use the Buffer here
        },
      ],
    };
    console.log('Sending email to:', internEmail); // Add this line for debugging

    // Send the email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      } else {
        console.log('Email sent:', info.response);
        res.status(200).json({ message: 'Email sent successfully' });
      }
    });
  } catch (bufferError) {
    console.error('Error creating buffer:', bufferError);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Add this route to your existing server code
app.post('/check-email', (req, res) => {
  const email = req.body.email;

  if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const checkUserQuery = 'SELECT * FROM user WHERE email = ?';
  db.query(checkUserQuery, [email], (checkErr, checkResult) => {
      if (checkErr) {
          console.error('Error checking email:', checkErr);
          return res.status(500).json({ success: false, message: 'Internal Server Error' });
      }

      if (checkResult.length > 0) {
          // Email is registered
          return res.status(200).json({ success: true, message: 'Email is registered' });
      } else {
          // Email is not registered
          return res.status(404).json({ success: false, message: 'Email not registered' });
      }
  });
});

// Add this route to your existing server code
app.post('/send-forgot-link', (req, res) => {
  const email = req.body.email;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  // Generate a reset token and store it in the database
  const resetToken = generateResetToken();

  // Save reset token and expiration time in the database
  const saveTokenQuery = 'UPDATE user SET reset_token = ?, reset_token_expires = ? WHERE email = ?';
  const expirationTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  db.query(saveTokenQuery, [resetToken, expirationTime, email], (saveErr, saveResult) => {
    if (saveErr) {
      console.error('Error saving reset token:', saveErr);
      return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }

    // Send the reset link to the user's email
    const resetLink = `http://localhost:3000/forget.html/${resetToken}`;
    sendResetEmail(email, resetLink); // Implement your email sending logic

    res.status(200).json({ success: true, message: 'Reset link sent successfully' });
  });
});

// Helper function to send reset email
function sendResetEmail(email, resetLink) {
 
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'mukulkms@gmail.com', // Replace with your Gmail email
      pass: 'hdvy hlzn kxdx gjiu', // Replace with your App Password
    },
  });


const mailOptions = {
  from: 'mukulkms@gmail.com',
  to: email,
  subject: 'Password Reset',
  text: `Click the link to reset your password: ${resetLink}`,
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('Error sending reset email:', error);
  } else {
    console.log('Reset email sent:', info.response);
  }
});
}

// Implement token generation logic
function generateResetToken() {
const crypto = require('crypto');
return crypto.randomBytes(32).toString('hex');
}


// Add a route to handle password reset
app.post('/reset-password/:token', (req, res) => {
  const resetToken = req.params.token;
  const newPassword = req.body.newPassword;

  // Validate the token and check if it's still valid
  // If valid, update the user's password and clear the reset token fields

  // Example query (you might need to adapt this to your database schema):
  const updatePasswordQuery = 'UPDATE user SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = ? AND reset_token_expires > NOW()';
  
  try {
    // Hash the new password before updating
    bcrypt.hash(newPassword, 10, (hashError, hashedPassword) => {
      if (hashError) {
        console.error('Error hashing password:', hashError);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
      }

      // Use the hashedPassword in the query
      db.query(updatePasswordQuery, [hashedPassword, resetToken], (updateErr, updateResult) => {
        if (updateErr) {
          console.error('Error updating password:', updateErr);
          return res.status(500).json({ success: false, message: 'Internal Server Error' });
        }

        if (updateResult.affectedRows > 0) {
          // Password reset successful, update reset token expiration to mark it as used
          const updateExpirationQuery = 'UPDATE user SET reset_token_expires = NOW() WHERE reset_token = ?';
          db.query(updateExpirationQuery, [resetToken], (expirationUpdateErr, expirationUpdateResult) => {
            if (expirationUpdateErr) {
              console.error('Error updating reset token expiration:', expirationUpdateErr);
              return res.status(500).json({ success: false, message: 'Internal Server Error' });
            }

            res.status(200).json({ success: true, message: 'Password reset successful' });
          });
        } else {
          res.status(400).json({ success: false, message: 'Invalid or expired token' });
        }
      });
    });
  } catch (error) {
    console.error('Error during password reset:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});



// Add a route to handle password reset
app.get('/forget.html/:token', (req, res) => {
  // Extract the token from the request parameters
  const resetToken = req.params.token;

  // Render your password reset HTML page or redirect to a password reset page
  // Example:
  res.sendFile(path.join(__dirname, 'public', 'forget.html'));
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
