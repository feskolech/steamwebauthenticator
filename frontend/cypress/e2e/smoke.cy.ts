describe('SteamGuard Web smoke', () => {
  it('renders login screen', () => {
    cy.visit('/login');
    cy.contains('SteamGuard Web');
    cy.contains('Login');
  });
});
