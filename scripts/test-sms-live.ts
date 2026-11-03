import '../server/src/env.ts';
import { getEnvSmsConfig, normalizeIndianPhone, dispatchToGateway } from '../server/src/services/smsService.ts';

async function main() {
  const config = getEnvSmsConfig();
  console.log('\n========================================');
  console.log('       SMS GATEWAY LIVE TEST TOOL       ');
  console.log('========================================');
  console.log(`Provider: ${config.provider}`);
  console.log(`API Key configured: ${config.apiKey ? 'YES (Masked: ' + config.apiKey.slice(0, 3) + '••••' + config.apiKey.slice(-3) + ', length: ' + config.apiKey.length + ')' : 'NO'}`);
  console.log(`Sender ID: ${config.senderId || '(None - default route)'}`);
  console.log(`Template/Flow ID: ${config.templateId || '(None - quick route)'}`);

  // Provider-specific verification
  if (config.provider === 'fast2sms') {
    if (!config.apiKey) {
      console.error('\n❌ ERROR: SMS_API_KEY is missing in your .env file.');
      process.exit(1);
    }
    console.log('\n[1/3] Verifying Fast2SMS authorization key with Fast2SMS Dev API...');
    try {
      const walletRes = await fetch('https://www.fast2sms.com/dev/wallet', {
        headers: { authorization: config.apiKey },
      });
      const walletData: any = await walletRes.json().catch(() => ({}));

      if (!walletRes.ok || walletData.return === false) {
        console.error('❌ Fast2SMS Key Verification Failed:');
        console.error(`   Status Code: ${walletData.status_code || walletRes.status}`);
        console.error(`   Message: ${walletData.message || 'Invalid authorization key'}`);
      } else {
        console.log(`✅ Fast2SMS API Key is VALID!`);
        console.log(`   Wallet Balance: ₹${walletData.wallet ?? '0'}`);
      }
    } catch (err: any) {
      console.warn('⚠️ Network warning during wallet check:', err.message);
    }
  }

  // Mobile number
  const targetPhone = process.argv[2] || '9994377596';
  const norm = normalizeIndianPhone(targetPhone);
  if (!norm) {
    console.error(`\n❌ Invalid Indian mobile number "${targetPhone}".`);
    console.error('Must be a 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
    process.exit(1);
  }

  const customMessage = process.argv[3] || 'This is a test SMS from SKS Super Market billing software. SMS integration is working successfully.';

  console.log(`\n[2/3] Preparing test SMS dispatch:`);
  console.log(`   Recipient: +91 ${norm.digits10}`);
  console.log(`   Message: "${customMessage}"`);
  console.log(`   Route: Quick SMS (route: 'q')`);

  console.log(`\n[3/3] Sending request to Fast2SMS API (POST https://www.fast2sms.com/dev/bulkV2)...`);

  const result = await dispatchToGateway(norm, customMessage, config, {
    name: 'Customer',
    shop: 'SKS Super Market',
    bill_no: 'TEST-001',
    amount: '100.00',
    points: '10',
  });

  console.log('\n========================================');
  console.log('         FAST2SMS API RESPONSE          ');
  console.log('========================================');

  if (result.success) {
    console.log('✅ API Dispatch Status: SUCCESS (Accepted by Gateway)');
    console.log(`   Gateway Message ID: ${result.messageId}`);
    if (result.rawResponse) {
      console.log('   Raw Response:', JSON.stringify(result.rawResponse, null, 2));
    }
    console.log(`\n📲 Please check mobile device +91 ${norm.digits10} for SMS arrival!`);
  } else {
    console.log('❌ API Dispatch Status: FAILED');
    console.log(`   Error: ${result.error}`);
    if (result.rawResponse) {
      console.log('   Raw Response:', JSON.stringify(result.rawResponse, null, 2));
    }

    if ((result.rawResponse as any)?.status_code === 412) {
      console.log('\n🔍 DIAGNOSIS: Status 412 "Invalid Authentication, Check Authorization Key"');
      console.log('The key in your .env is being rejected by Fast2SMS authentication server.');
      console.log('Common causes:');
      console.log('1. Special characters (e.g. "@") were appended or pasted in .env.');
      console.log('2. Your account password or email was pasted instead of the Dev API Authorization Key.');
      console.log('3. Fast2SMS generated a new key or revoked this one.');
      console.log('\n👉 HOW TO FIX:');
      console.log('1. Log in to https://www.fast2sms.com/dashboard/dev-api');
      console.log('2. Under "API Authorization Key", click the Copy button (or click "Generate New Key").');
      console.log('3. Paste the clean alphanumeric key into .env:');
      console.log('   SMS_API_KEY=your_copied_key_here');
    } else if ((result.rawResponse as any)?.status_code === 999 || result.error?.includes('100 INR')) {
      console.log('\n🔍 DIAGNOSIS: Status 999 "You need to complete one transaction of 100 INR or more"');
      console.log('Fast2SMS policy requires a one-time minimum ₹100 recharge to unlock external API sending.');
      console.log('Recharge ₹100 at: https://www.fast2sms.com/dashboard/add-amount');
    }
  }
  console.log('========================================\n');
}

main().catch(console.error);
