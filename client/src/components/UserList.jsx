import React from 'react';

const UserList = ({ users, presenceAvailable }) => (
  <section className="user-list" aria-labelledby="online-users-heading">
    <h3 id="online-users-heading" aria-live="polite">
      {presenceAvailable ? `En ligne (${users.length})` : 'Présence indisponible'}
    </h3>
    {!presenceAvailable ? (
      <p className="presence-message">L’application hôte ne fournit pas la présence.</p>
    ) : users.length === 0 ? (
      <p className="presence-message">Aucun participant en ligne.</p>
    ) : (
      <ul className="users">
        {users.map((user) => (
          <li key={user.id} className="user-item">
            <span className="user-avatar" aria-hidden="true">
              {Array.from(user.name)[0]?.toUpperCase() || '?'}
            </span>
            <span className="user-name">{user.name}</span>
          </li>
        ))}
      </ul>
    )}
  </section>
);

export default UserList;