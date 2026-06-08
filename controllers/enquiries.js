const mongoose = require('mongoose');
const ServiceEnquiry = require('../models/service_enquiry');
const EnquiryCatalogCategory = require('../models/enquiry_catalog_category');

function isAdmin(req) {
  return String(req.user && req.user.role ? req.user.role : '').toLowerCase() === 'admin';
}

function actorName(req) {
  return String(
    (req.user && (req.user.name || req.user.username || req.user.email)) || ''
  ).trim();
}

function serializeEnquiry(row) {
  return {
    id: String(row._id),
    firstName: String(row.firstName || '').trim(),
    phone: String(row.phone || '').trim(),
    action: String(row.action || 'print'),
    createdByName: String(row.createdByName || '').trim(),
    createdAt: row.createdAt
  };
}

async function buildCatalog(req) {
  const categories = await EnquiryCatalogCategory.find({})
    .sort({ orderIndex: 1, name: 1, _id: 1 })
    .lean();

  return categories.map(serializeCatalogCategory);
}

exports.page = async function page(req, res) {
  return res.render('registrations/enquiries', {
    title: 'Our Services',
    isAdmin: isAdmin(req)
  });
};

function serializeCatalogCategory(category) {
  return {
    id: String(category._id),
    name: String(category.name || '').trim(),
    services: (Array.isArray(category.services) ? category.services : [])
      .slice()
      .sort((a, b) => (Number(a.orderIndex || 0) - Number(b.orderIndex || 0)) || String(a.name || '').localeCompare(String(b.name || '')))
      .map(service => ({
        id: String(service._id),
        name: String(service.name || '').trim()
      }))
  };
}

function requireAdminJson(req, res) {
  if (isAdmin(req)) return true;
  res.status(403).json({ ok: false, error: 'Admin access required' });
  return false;
}

function cleanName(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max || 120);
}

exports.apiCatalog = async function apiCatalog(req, res) {
  try {
    const catalog = await buildCatalog(req);
    return res.json({ ok: true, catalog });
  } catch (err) {
    console.error('enquiries.apiCatalog error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load our services' });
  }
};

exports.apiList = async function apiList(req, res) {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page || 1)) || 1);
    const limitRaw = Math.max(1, Math.floor(Number(req.query.limit || 100)) || 100);
    const limit = Math.min(limitRaw, 200);
    const skip = (page - 1) * limit;

    const rows = await ServiceEnquiry.find({})
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const enquiries = (hasMore ? rows.slice(0, limit) : rows).map(serializeEnquiry);
    return res.json({ ok: true, enquiries, page, limit, hasMore });
  } catch (err) {
    console.error('enquiries.apiList error', err);
    return res.status(500).json({ ok: false, error: 'Failed to load enquiries' });
  }
};

exports.apiCreate = async function apiCreate(req, res) {
  try {
    const phone = String(req.body && req.body.phone ? req.body.phone : '').trim();
    const firstName = String(req.body && req.body.firstName ? req.body.firstName : '').trim().slice(0, 80);
    const action = String(req.body && req.body.action ? req.body.action : 'print').toLowerCase() === 'share' ? 'share' : 'print';

    if (!phone) {
      return res.status(400).json({ ok: false, error: 'Customer phone number is required' });
    }

    const doc = await ServiceEnquiry.create({
      firstName,
      phone,
      action,
      createdBy: req.user && req.user._id && mongoose.Types.ObjectId.isValid(req.user._id) ? req.user._id : null,
      createdByName: actorName(req)
    });

    return res.json({ ok: true, enquiry: serializeEnquiry(doc) });
  } catch (err) {
    console.error('enquiries.apiCreate error', err);
    return res.status(500).json({ ok: false, error: 'Failed to save enquiry' });
  }
};

exports.apiCreateCatalogCategory = async function apiCreateCatalogCategory(req, res) {
  try {
    if (!requireAdminJson(req, res)) return;
    const name = cleanName(req.body && req.body.name, 80);
    if (!name) return res.status(400).json({ ok: false, error: 'Category name is required' });

    const top = await EnquiryCatalogCategory.findOne({})
      .sort({ orderIndex: -1, createdAt: -1 })
      .select('orderIndex')
      .lean();
    const category = await EnquiryCatalogCategory.create({
      name,
      orderIndex: Number((top && top.orderIndex) || 0) + 1,
      createdBy: req.user && req.user._id ? req.user._id : null,
      updatedBy: req.user && req.user._id ? req.user._id : null
    });

    return res.json({ ok: true, category: serializeCatalogCategory(category) });
  } catch (err) {
    console.error('enquiries.apiCreateCatalogCategory error', err);
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: 'This enquiry category already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Failed to create enquiry category' });
  }
};

exports.apiUpdateCatalogCategory = async function apiUpdateCatalogCategory(req, res) {
  try {
    if (!requireAdminJson(req, res)) return;
    const id = String(req.params.categoryId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid category id' });
    const name = cleanName(req.body && req.body.name, 80);
    if (!name) return res.status(400).json({ ok: false, error: 'Category name is required' });

    const category = await EnquiryCatalogCategory.findByIdAndUpdate(
      id,
      { name, updatedBy: req.user && req.user._id ? req.user._id : null },
      { new: true }
    );
    if (!category) return res.status(404).json({ ok: false, error: 'Category not found' });
    return res.json({ ok: true, category: serializeCatalogCategory(category) });
  } catch (err) {
    console.error('enquiries.apiUpdateCatalogCategory error', err);
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: 'This enquiry category already exists' });
    }
    return res.status(500).json({ ok: false, error: 'Failed to update enquiry category' });
  }
};

exports.apiDeleteCatalogCategory = async function apiDeleteCatalogCategory(req, res) {
  try {
    if (!requireAdminJson(req, res)) return;
    const id = String(req.params.categoryId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid category id' });

    const deleted = await EnquiryCatalogCategory.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Category not found' });
    return res.json({ ok: true, id });
  } catch (err) {
    console.error('enquiries.apiDeleteCatalogCategory error', err);
    return res.status(500).json({ ok: false, error: 'Failed to delete enquiry category' });
  }
};

exports.apiCreateCatalogService = async function apiCreateCatalogService(req, res) {
  try {
    if (!requireAdminJson(req, res)) return;
    const id = String(req.params.categoryId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid category id' });
    const name = cleanName(req.body && req.body.name, 120);
    if (!name) return res.status(400).json({ ok: false, error: 'Service name is required' });

    const category = await EnquiryCatalogCategory.findById(id);
    if (!category) return res.status(404).json({ ok: false, error: 'Category not found' });
    const topIndex = (category.services || []).reduce((max, service) => Math.max(max, Number(service.orderIndex || 0)), 0);
    category.services.push({ name, orderIndex: topIndex + 1 });
    category.updatedBy = req.user && req.user._id ? req.user._id : null;
    await category.save();
    return res.json({ ok: true, category: serializeCatalogCategory(category) });
  } catch (err) {
    console.error('enquiries.apiCreateCatalogService error', err);
    return res.status(500).json({ ok: false, error: 'Failed to add enquiry service' });
  }
};

exports.apiUpdateCatalogService = async function apiUpdateCatalogService(req, res) {
  try {
    if (!requireAdminJson(req, res)) return;
    const categoryId = String(req.params.categoryId || '').trim();
    const serviceId = String(req.params.serviceId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ ok: false, error: 'Invalid service id' });
    }
    const name = cleanName(req.body && req.body.name, 120);
    if (!name) return res.status(400).json({ ok: false, error: 'Service name is required' });

    const category = await EnquiryCatalogCategory.findById(categoryId);
    if (!category) return res.status(404).json({ ok: false, error: 'Category not found' });
    const service = category.services.id(serviceId);
    if (!service) return res.status(404).json({ ok: false, error: 'Service not found' });
    service.name = name;
    category.updatedBy = req.user && req.user._id ? req.user._id : null;
    await category.save();
    return res.json({ ok: true, category: serializeCatalogCategory(category) });
  } catch (err) {
    console.error('enquiries.apiUpdateCatalogService error', err);
    return res.status(500).json({ ok: false, error: 'Failed to update enquiry service' });
  }
};

exports.apiDeleteCatalogService = async function apiDeleteCatalogService(req, res) {
  try {
    if (!requireAdminJson(req, res)) return;
    const categoryId = String(req.params.categoryId || '').trim();
    const serviceId = String(req.params.serviceId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ ok: false, error: 'Invalid service id' });
    }

    const category = await EnquiryCatalogCategory.findById(categoryId);
    if (!category) return res.status(404).json({ ok: false, error: 'Category not found' });
    const service = category.services.id(serviceId);
    if (!service) return res.status(404).json({ ok: false, error: 'Service not found' });
    service.deleteOne();
    category.updatedBy = req.user && req.user._id ? req.user._id : null;
    await category.save();
    return res.json({ ok: true, category: serializeCatalogCategory(category) });
  } catch (err) {
    console.error('enquiries.apiDeleteCatalogService error', err);
    return res.status(500).json({ ok: false, error: 'Failed to delete enquiry service' });
  }
};
