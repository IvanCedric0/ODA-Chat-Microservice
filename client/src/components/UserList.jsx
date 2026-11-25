import React from "react";

const UserList = ( { users}) => {
    return (
        <div className="user-list">
            <h3>Utilisateur en ligne ({users.length})</h3>
            <div className="users">
                {users.map ((user) => (
                    <div key={user.id} className="user-item">
                        <div className="user-avatar">
                        {(user.name?.charAt(0) || '?').toUpperCase()}
                       </div>
                            <span className="user-name">{user.name}</span>
                        </div>
                ))}
            </div>
        </div>
    )



}

export default UserList;