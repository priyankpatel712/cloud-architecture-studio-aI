const nodemailer = require('nodemailer');

async function testPort(port) {
  console.log(`Testing port ${port}...`);
  const transporter = nodemailer.createTransport({
    host: "sandbox.smtp.mailtrap.io",
    port: port,
    secure: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    auth: {
      user: "158651ef857574",
      pass: "90a9a4499b856a"
    }
  });

  try {
    const info = await transporter.sendMail({
      from: "Cloud Architecture Studio <from@example.com>",
      to: "mailtrap-test@example.com",
      subject: `Test email from Node script on port ${port}`,
      text: `Hello Mailtrap on port ${port}!`
    });
    console.log(`Success on port ${port}:`, info.messageId);
    return true;
  } catch (err) {
    console.error(`Error on port ${port}:`, err.message);
    return false;
  }
}

async function main() {
  await testPort(587);
  await testPort(2525);
  await testPort(25);
}

main();
