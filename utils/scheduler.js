/**
 * Scheduled Email Worker
 * Polls Firestore for pending scheduled emails and sends them when their time arrives.
 * Runs every 60 seconds.
 */

import { db } from '../firebase-admin.js';
import { sendEmail, getMailConfig } from './mailer.js';

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute
let timer = null;

async function processScheduledEmails() {
  try {
    const now = new Date().toISOString();

    // Find all pending emails that are due
    const snapshot = await db.collection('scheduled_emails')
      .where('status', '==', 'pending')
      .get();

    if (snapshot.empty) return;

    const due = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.scheduledAt && e.scheduledAt <= now);

    if (due.length === 0) return;

    console.log(JSON.stringify({
      level: 'info',
      type: 'SCHEDULER',
      event: 'processing_scheduled_emails',
      count: due.length,
      timestamp: now,
    }));

    const mailConfig = await getMailConfig();
    if (!mailConfig) {
      console.warn(JSON.stringify({
        level: 'warn',
        type: 'SCHEDULER',
        event: 'mail_config_missing',
        message: 'Cannot send scheduled emails — mail config not found',
        timestamp: now,
      }));
      return;
    }

    for (const email of due) {
      try {
        // Mark as processing to prevent duplicate sends
        await db.collection('scheduled_emails').doc(email.id).update({
          status: 'processing',
          processedAt: new Date().toISOString(),
        });

        // Send the email
        const result = await sendEmail({
          to: Array.isArray(email.to) ? email.to.join(', ') : email.to,
          cc: Array.isArray(email.cc) ? email.cc.join(', ') : (email.cc || undefined),
          bcc: Array.isArray(email.bcc) ? email.bcc.join(', ') : (email.bcc || undefined),
          subject: email.subject,
          html: email.html || undefined,
          text: email.text || undefined,
          attachments: email.attachments || [],
        }, mailConfig);

        // Mark as sent
        await db.collection('scheduled_emails').doc(email.id).update({
          status: 'sent',
          sentAt: new Date().toISOString(),
          messageId: result?.messageId || null,
        });

        // Also save to sent_emails collection
        await db.collection('sent_emails').add({
          to: email.to,
          cc: email.cc || [],
          bcc: email.bcc || [],
          subject: email.subject,
          html: email.html || '',
          text: email.text || '',
          source: 'scheduled',
          scheduledEmailId: email.id,
          sentAt: new Date().toISOString(),
          createdBy: email.createdBy,
        });

        console.log(JSON.stringify({
          level: 'info',
          type: 'SCHEDULER',
          event: 'scheduled_email_sent',
          emailId: email.id,
          to: email.to,
          subject: email.subject,
          timestamp: new Date().toISOString(),
        }));
      } catch (sendErr) {
        // Mark as failed
        await db.collection('scheduled_emails').doc(email.id).update({
          status: 'failed',
          error: sendErr.message || 'Send failed',
          failedAt: new Date().toISOString(),
        });

        console.error(JSON.stringify({
          level: 'error',
          type: 'SCHEDULER',
          event: 'scheduled_email_failed',
          emailId: email.id,
          error: sendErr.message,
          timestamp: new Date().toISOString(),
        }));
      }
    }
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      type: 'SCHEDULER',
      event: 'scheduler_poll_error',
      error: err.message,
      timestamp: new Date().toISOString(),
    }));
  }
}

export function startScheduler() {
  if (timer) return; // Already running

  console.log(JSON.stringify({
    level: 'info',
    type: 'SCHEDULER',
    event: 'started',
    interval: POLL_INTERVAL_MS + 'ms',
    timestamp: new Date().toISOString(),
  }));

  // Run immediately, then on interval
  processScheduledEmails();
  timer = setInterval(processScheduledEmails, POLL_INTERVAL_MS);
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log(JSON.stringify({
      level: 'info',
      type: 'SCHEDULER',
      event: 'stopped',
      timestamp: new Date().toISOString(),
    }));
  }
}
