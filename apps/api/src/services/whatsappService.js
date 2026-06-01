const axios = require('axios');
const { env } = require('../config/env');

const WA_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Send a WhatsApp template message
 *
 * @param {string} to - Phone number in E.164 format (+919876543210)
 * @param {string} templateName - Approved Meta template name
 * @param {string} language - Template language code (default: 'en')
 * @param {Array} bodyParams - Template body parameters [{type: 'text', text: 'value'}]
 * @param {object} options - Optional: { phoneNumberId, accessToken, ctaUrl }
 */
async function sendTemplateMessage(to, templateName, language = 'en', bodyParams = [], options = {}) {
  const phoneNumberId = options.phoneNumberId || env.WA_PHONE_NUMBER_ID;
  const accessToken = options.accessToken || env.WA_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error('WhatsApp credentials not configured');
  }

  const components = [];

  // Body parameters
  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((p) =>
        typeof p === 'string' ? { type: 'text', text: p } : p
      ),
    });
  }

  // CTA button URL parameter (if dynamic)
  if (options.ctaUrl) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: options.ctaUrl }],
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace('+', ''), // Meta API wants number without +
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: components.length > 0 ? components : undefined,
    },
  };

  try {
    const response = await axios.post(
      `${WA_API_BASE}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    return {
      success: true,
      messageId,
      raw: response.data,
    };
  } catch (err) {
    const errorData = err.response?.data?.error || {};
    console.error('WhatsApp API error:', {
      code: errorData.code,
      message: errorData.message,
      details: errorData.error_data,
    });

    return {
      success: false,
      error: errorData.message || err.message,
      errorCode: errorData.code,
      raw: err.response?.data,
    };
  }
}

/**
 * Send a simple text message (only works within 24h customer service window)
 * Use this for replies, NOT for outbound marketing
 */
async function sendTextMessage(to, text, options = {}) {
  const phoneNumberId = options.phoneNumberId || env.WA_PHONE_NUMBER_ID;
  const accessToken = options.accessToken || env.WA_ACCESS_TOKEN;

  const payload = {
    messaging_product: 'whatsapp',
    to: to.replace('+', ''),
    type: 'text',
    text: { body: text },
  };

  const response = await axios.post(
    `${WA_API_BASE}/${phoneNumberId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

/**
 * Get WhatsApp message template status
 */
async function getTemplateStatus(templateName, options = {}) {
  const wabaId = options.businessAccountId || env.WA_BUSINESS_ACCOUNT_ID;
  const accessToken = options.accessToken || env.WA_ACCESS_TOKEN;

  const response = await axios.get(
    `${WA_API_BASE}/${wabaId}/message_templates`,
    {
      params: { name: templateName },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  return response.data?.data?.[0] || null;
}

module.exports = {
  sendTemplateMessage,
  sendTextMessage,
  getTemplateStatus,
};
