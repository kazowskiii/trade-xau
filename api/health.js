module.exports = (req, res) => {
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
};