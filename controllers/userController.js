const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cloudinary = require("cloudinary").v2;
const NodeGeocoder = require('node-geocoder');

// Konfiguracija geokodera
const options = {
    provider: 'openstreetmap',
    formatter: null,
    httpAdapter: 'https',
    timeout: 5000,
    headers: {
        'user-agent': 'VibrA/1.0',
        'referrer': 'http://localhost:5000'
    }
};
const geocoder = NodeGeocoder(options);

// Prijava korisnika
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log("LOGIN: Pokušaj prijave za e-mail:", email);

        const user = await User.findOne({ email });
        if (!user) {
            console.log("LOGIN: Korisnik nije pronađen za e-mail:", email);
            return res.status(400).json({ message: "User not found" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log("LOGIN: Pogrešni podaci za e-mail:", email);
            return res.status(400).json({ message: "Invalid credentials" });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
            expiresIn: "3h",
        });

        console.log("LOGIN: Token uspešno generisan za korisnika:", email);

        return res.status(200).json({
            message: "Login successful",
            token,
            profilePictures: user.profilePictures,
        });
    } catch (error) {
        console.error("LOGIN: Greška tokom prijave:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Brisanje slike iz profila
exports.deleteProfilePicture = async (req, res) => {
    try {
        const userId = req.user.id;
        const { imageUrl } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ message: "Image URL is required" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        const parts = imageUrl.split("/");
        const filename = parts[parts.length - 1];
        const publicId = filename.split(".")[0];

        await cloudinary.uploader.destroy(publicId);

        user.profilePictures = user.profilePictures.filter(
            (url) => url !== imageUrl
        );
        await user.save();

        return res.status(200).json({
            message: "Image deleted successfully",
            profilePictures: user.profilePictures,
        });
    } catch (error) {
        console.error("Greška pri brisanju slike:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Ažuriranje profila korisnika
exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { field, value, latitude, longitude } = req.body;
        
        let updateObject = {};

        // Slučaj 1: Ažuriranje lokacije
        if (latitude !== undefined && longitude !== undefined) {
            console.log(`UPDATE_PROFILE: Ažuriranje lokacije za korisnika ${userId}`);
            
            let city = null;
            try {
                const geoResult = await geocoder.reverse({ lat: latitude, lon: longitude });
                if (geoResult && geoResult.length > 0) {
                    city = geoResult[0].city || geoResult[0].locality || geoResult[0].town || null;
                    if(city) console.log(`UPDATE_PROFILE: Grad pronađen: ${city}`);
                }
            } catch (geoError) {
                console.error("Greška pri geokodiranju:", geoError);
            }
            
            updateObject = {
                'location.latitude': latitude,
                'location.longitude': longitude,
            };
            
            if (city) {
                updateObject['location.locationCity'] = city;
            }

        } 
        // Slučaj 2: Ažuriranje ostalih polja
        else if (field) {
            console.log(`UPDATE_PROFILE: Ažuriranje polja '${field}' na vrednost '${value}' za korisnika ${userId}`);
            if (typeof value === 'undefined') {
                return res.status(400).json({ message: 'Nevažeći podaci za ažuriranje.' });
            }
            updateObject = { [field]: value };
        } 
        // Slučaj 3: Invalidan zahtev
        else {
            return res.status(400).json({ message: 'Nevažeći podaci za ažuriranje. Nedostaje polje ili koordinate lokacije.' });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateObject },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            console.log('UPDATE_PROFILE: Korisnik nije pronađen.');
            return res.status(404).json({ message: 'Korisnik nije pronađen' });
        }

        console.log('UPDATE_PROFILE: Profil uspešno ažuriran.');
        return res.status(200).json({ message: 'Profil uspešno ažuriran' });
    } catch (error) {
        console.error('UPDATE_PROFILE: Greška pri ažuriranju profila:', error);
        return res.status(500).json({ message: 'Interna greška servera.' });
    }
};


// Dohvatanje profila po ID-u
exports.getProfileById = async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ message: 'Korisnik nije pronađen' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Interna greška servera' });
    }
};

// Dohvatanje profila trenutno ulogovanog korisnika
exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};

// Dohvatanje svih korisnika
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find({}, "fullName avatar _id profilePictures birthDate");
        const updatedUsers = users.map(user => {
            if (!user.avatar) {
                user.avatar = "https://path/to/default-avatar.jpg";
            }
            return user;
        });
        res.json(updatedUsers);
    } catch (error) {
        res.status(500).json({ message: "Greška pri dohvaćanju korisnika" });
    }
};