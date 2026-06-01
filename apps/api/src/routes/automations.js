const express = require('express');
const { supabase } = require('../config/database');
const { authenticateJWT } = require('../middleware/authJWT');
const { automationRuleSchema } = require('../utils/validators');

const router = express.Router();
router.use(authenticateJWT);

// ======================== LIST RULES ========================
router.get('/', async (req, res, next) => {
  try {
    const { data: rules, error } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('client_id', req.client.id)
      .order('priority', { ascending: false });

    if (error) throw error;
    res.json({ rules: rules || [] });
  } catch (err) {
    next(err);
  }
});

// ======================== GET SINGLE RULE ========================
router.get('/:id', async (req, res, next) => {
  try {
    const { data: rule, error } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('id', req.params.id)
      .eq('client_id', req.client.id)
      .single();

    if (error || !rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ rule });
  } catch (err) {
    next(err);
  }
});

// ======================== CREATE RULE ========================
router.post('/', async (req, res, next) => {
  try {
    const body = automationRuleSchema.parse(req.body);

    const { data: rule, error } = await supabase
      .from('automation_rules')
      .insert({ ...body, client_id: req.client.id })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ rule });
  } catch (err) {
    next(err);
  }
});

// ======================== UPDATE RULE ========================
router.put('/:id', async (req, res, next) => {
  try {
    const body = automationRuleSchema.partial().parse(req.body);

    const { data: rule, error } = await supabase
      .from('automation_rules')
      .update(body)
      .eq('id', req.params.id)
      .eq('client_id', req.client.id)
      .select()
      .single();

    if (error || !rule) return res.status(404).json({ error: 'Rule not found' });
    res.json({ rule });
  } catch (err) {
    next(err);
  }
});

// ======================== DELETE RULE ========================
router.delete('/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('automation_rules')
      .delete()
      .eq('id', req.params.id)
      .eq('client_id', req.client.id);

    if (error) throw error;
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
