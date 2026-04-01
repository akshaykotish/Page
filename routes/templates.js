import { Router } from 'express';
import { db } from '../firebase-admin.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { asyncHandler, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import { validate, validateQuery } from '../middleware/validator.js';

const router = Router();
router.use(verifyToken);
router.use(requireRole('superadmin', 'admin'));

const VALID_TYPES = ['letterhead', 'bill_header', 'bill_footer', 'letterhead_footer'];
const VALID_CATEGORIES = ['business', 'legal', 'finance', 'hr', 'marketing', 'general'];

// ─── Helper: Pagination defaults ──────────────────────────────────────────────

function getPaginationParams(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// ─── List templates with pagination ───────────────────────────────────────────

router.get('/', validateQuery({ page: 'optionalString', limit: 'optionalString', type: 'optionalString', category: 'optionalString' }), asyncHandler(async (req, res) => {
  const { skip, limit, page } = getPaginationParams(req);
  const { type, category } = req.query;

  let query = db.collection('templates');
  if (type) query = query.where('type', '==', type.toLowerCase());
  if (category) query = query.where('category', '==', category);

  const snapshot = await query.orderBy('updatedAt', 'desc').get();
  const docs = snapshot.docs;
  const total = docs.length;
  const paginated = docs.slice(skip, skip + limit);

  console.info(JSON.stringify({
    level: 'info', action: 'list_templates', userId: req.user.uid,
    filters: { type: !!type, category: !!category },
    pagination: { page, limit, total }, timestamp: new Date().toISOString(),
  }));

  res.json({
    data: paginated.map(doc => ({ id: doc.id, ...doc.data() })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
}));

// ─── Get single template ─────────────────────────────────────────────────────

router.get('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('templates').doc(req.params.id).get();
  if (!doc.exists) throw new NotFoundError('Template');
  res.json({ id: doc.id, ...doc.data() });
}));

// ─── Create template ────────────────────────────────────────────────────────

router.post('/', validate('createTemplate'), asyncHandler(async (req, res) => {
  const { name, type, canvasJSON, width, height, thumbnail, category, variables } = req.body;

  if (!name || name.trim().length === 0) {
    throw new ValidationError('Template name is required');
  }

  const templateType = type && typeof type === 'string' ? type.toLowerCase() : 'letterhead';
  if (!VALID_TYPES.includes(templateType)) {
    throw new ValidationError('Invalid template type', [`Type must be one of: ${VALID_TYPES.join(', ')}`]);
  }

  if (!canvasJSON || typeof canvasJSON !== 'object') {
    throw new ValidationError('Canvas JSON is required and must be a valid object');
  }

  const template = {
    name: name.trim(),
    type: templateType,
    category: category && VALID_CATEGORIES.includes(category) ? category : 'general',
    canvasJSON,
    width: width && typeof width === 'number' ? width : 794,
    height: height && typeof height === 'number' ? height : 200,
    thumbnail: thumbnail || '',
    variables: Array.isArray(variables) ? variables : [],
    isDefault: false,
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const docRef = await db.collection('templates').add(template);

  console.info(JSON.stringify({
    level: 'info', action: 'create_template', templateId: docRef.id,
    name, type: templateType, userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...template });
}));

// ─── Update template ────────────────────────────────────────────────────────

router.put('/:id', asyncHandler(async (req, res) => {
  const { name, canvasJSON, width, height, thumbnail, isDefault, category, variables } = req.body;

  const doc = await db.collection('templates').doc(req.params.id).get();
  if (!doc.exists) throw new NotFoundError('Template');

  const update = { updatedAt: new Date().toISOString() };
  if (name !== undefined) update.name = name.trim();
  if (canvasJSON !== undefined) update.canvasJSON = canvasJSON;
  if (width !== undefined) update.width = width;
  if (height !== undefined) update.height = height;
  if (thumbnail !== undefined) update.thumbnail = thumbnail;
  if (category !== undefined && VALID_CATEGORIES.includes(category)) update.category = category;
  if (variables !== undefined && Array.isArray(variables)) update.variables = variables;

  // If setting as default, unset other defaults of same type
  if (isDefault === true) {
    const docData = doc.data();
    const templateType = docData.type;
    const others = await db.collection('templates')
      .where('type', '==', templateType)
      .where('isDefault', '==', true)
      .get();

    if (!others.empty) {
      const batch = db.batch();
      others.docs.forEach(d => batch.update(d.ref, { isDefault: false }));
      await batch.commit();
    }
    update.isDefault = true;
  }

  await db.collection('templates').doc(req.params.id).update(update);

  console.info(JSON.stringify({
    level: 'info', action: 'update_template', templateId: req.params.id,
    isDefault: isDefault === true, userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.json({ success: true });
}));

// ─── Delete template ────────────────────────────────────────────────────────

router.delete('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('templates').doc(req.params.id).get();
  if (!doc.exists) throw new NotFoundError('Template');

  await db.collection('templates').doc(req.params.id).delete();

  console.info(JSON.stringify({
    level: 'info', action: 'delete_template', templateId: req.params.id,
    userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.status(204).send();
}));

// ─── Get default template by type ────────────────────────────────────────────

router.get('/default/:type', asyncHandler(async (req, res) => {
  const { type } = req.params;

  if (!VALID_TYPES.includes(type)) {
    throw new ValidationError('Invalid template type', [`Type must be one of: ${VALID_TYPES.join(', ')}`]);
  }

  const snapshot = await db.collection('templates')
    .where('type', '==', type)
    .where('isDefault', '==', true)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.info(JSON.stringify({
      level: 'info', action: 'get_default_template', type, found: false,
      userId: req.user.uid, timestamp: new Date().toISOString(),
    }));
    return res.json(null);
  }

  const defaultTemplate = snapshot.docs[0];
  console.info(JSON.stringify({
    level: 'info', action: 'get_default_template', type, found: true,
    templateId: defaultTemplate.id, userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.json({ id: defaultTemplate.id, ...defaultTemplate.data() });
}));

// ─── Export template ────────────────────────────────────────────────────────

router.get('/:id/export', asyncHandler(async (req, res) => {
  const doc = await db.collection('templates').doc(req.params.id).get();
  if (!doc.exists) throw new NotFoundError('Template');

  const data = doc.data();
  const exportData = {
    _exportVersion: 1,
    _exportedAt: new Date().toISOString(),
    name: data.name,
    type: data.type,
    category: data.category || 'general',
    canvasJSON: data.canvasJSON,
    width: data.width,
    height: data.height,
    variables: data.variables || [],
  };

  res.json(exportData);
}));

// ─── Import template ────────────────────────────────────────────────────────

router.post('/import', asyncHandler(async (req, res) => {
  const { name, type, canvasJSON, width, height, category, variables } = req.body;

  if (!name || !canvasJSON) {
    throw new ValidationError('Template name and canvasJSON are required for import');
  }

  const templateType = type && VALID_TYPES.includes(type) ? type : 'letterhead';

  const template = {
    name: name.trim(),
    type: templateType,
    category: category && VALID_CATEGORIES.includes(category) ? category : 'general',
    canvasJSON: typeof canvasJSON === 'string' ? JSON.parse(canvasJSON) : canvasJSON,
    width: width || 794,
    height: height || 200,
    thumbnail: '',
    variables: Array.isArray(variables) ? variables : [],
    isDefault: false,
    createdBy: req.user.uid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const docRef = await db.collection('templates').add(template);

  console.info(JSON.stringify({
    level: 'info', action: 'import_template', templateId: docRef.id,
    name: template.name, userId: req.user.uid, timestamp: new Date().toISOString(),
  }));

  res.status(201).json({ id: docRef.id, ...template });
}));

// ─── Get all categories ─────────────────────────────────────────────────────

router.get('/meta/categories', asyncHandler(async (req, res) => {
  res.json(VALID_CATEGORIES);
}));

export default router;
