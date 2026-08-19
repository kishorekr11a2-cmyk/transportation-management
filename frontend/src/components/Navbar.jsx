import "../css/navbar.css";

function Navbar() {

    const user = JSON.parse(localStorage.getItem("user"));

    return (

        <div className="navbar">

            <h2>Admin Dashboard</h2>

            <div className="profile">

                {user?.name}

            </div>

        </div>

    );

}

export default Navbar;