const apps = [];

const messaging = () => ({
  sendEachForMulticast: jest.fn().mockResolvedValue({ responses: [] }),
});

const initializeApp = jest.fn(() => {
  const app = {};
  apps.push(app);
  return app;
});

const credential = {
  cert: jest.fn(() => ({})),
  applicationDefault: jest.fn(() => ({})),
};

module.exports = { apps, initializeApp, messaging, credential };
