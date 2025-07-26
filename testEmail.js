require('dotenv').config(); // 
const sendEmail = require('./sendEmail');


(async () => {
  try {
    await sendEmail({
      to: 'markostojanovic353@gmail.com',        
      subject: 'Test email',
      text: 'Ovo je testni email sa nodemailer-a.',
    });
    console.log('Mejl uspešno poslat!');
  } catch (error) {
    console.error('Greška pri slanju mejla:', error);
  }
})();
