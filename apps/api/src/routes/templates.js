const express = require('express');
const { supabase } = require('../config/database');
const { authenticateJWT } = require('../middleware/authJWT');
const { messageTemplateSchema } = require('../utils/validators');
const { getTemplateStatus } = require('../services/whatsappService');

const router = express.Router();
router.use(authenticateJWT);

// ======================== LIST TEMPLATES ========================
router.get('/', async (req, res, next) => {
  try {
    const { data: templates, error } = await supabase
      .from('message_templates')
      .select('*')
      .eq('client_id', req.client.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ templates: templates || [] });
  } catch (err) {
    next(err);
  }
});

// ======================== CREATE TEMPLATE ========================
router.post('/', async (req, res, next) => {
  try {
    const body = messageTemplateSchema.parse(req.body);

    // Check template limit based on plan
    const maxTemplates = req.client.plans?.max_templates || 3;
    const { count } = await supabase
      .from('message_templates')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', req.client.id);

    if (count >= maxTemplates) {
      return res.status(400).json({
        error: `Template limit reached (${maxTemplates} on ${req.client.plans?.name || 'Free'} plan)`,
      });
    }

    const { data: template, error } = await supabase
      .from('message_templates')
      .insert({ ...body, client_id: req.client.id })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ template });
  } catch (err) {
    next(err);
  }
});

// ======================== UPDATE TEMPLATE ========================
router.put('/:id', async (req, res, next) => {
  try {
    const body = messageTemplateSchema.partial().parse(req.body);

    const { data: template, error } = await supabase
      .from('message_templates')
      .update(body)
      .eq('id', req.params.id)
      .eq('client_id', req.client.id)
      .select()
      .single();

    if (error || !template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

// ======================== DELETE TEMPLATE ========================
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', req.params.id)
      .eq('client_id', req.client.id);

    if (error) throw error;
    res.json({ message: 'Template deleted' });
  } catch (err) {
    next(err);
  }
});

// ======================== CHECK TEMPLATE APPROVAL STATUS ========================
router.get('/:id/status', async (req, res, next) => {
  try {
    const { data: template } = await supabase
      .from('message_templates')
      .select('wa_template_name')
      .eq('id', req.params.id)
      .eq('client_id', req.client.id)
      .single();

    if (!template) return res.status(404).json({ error: 'Template not found' });

    // Check with Meta API
    const waStatus = await getTemplateStatus(template.wa_template_name, {
      businessAccountId: req.client.wa_business_id,
      accessToken: req.client.wa_access_token,
    });

    // Update our record if approved
    if (waStatus?.status === 'APPROVED') {
      await supabase
        .from('message_templates')
        .update({ is_approved: true })
        .eq('id', req.params.id);
    }

    res.json({
      wa_status: waStatus?.status || 'UNKNOWN',
      is_approved: waStatus?.status === 'APPROVED',
      rejection_reason: waStatus?.rejected_reason || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
