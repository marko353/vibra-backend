const cloudinary = require("../config/cloudinaryConfig");
const User = require("../models/User");

exports.uploadProfilePicture = async (req, res) => {
  try {
    const file = req.file;
    const userId = req.user.id;

    // Provera da li postoji fajl
    if (!file) {
      console.error('No file uploaded');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    console.log('File received:', file); // Loguj podatke o fajlu koji je primljen

    // Upload slike na Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'profile_pictures' },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else {
            console.log('Cloudinary upload result:', result);
            resolve(result);
          }
        }
      );
      stream.end(file.buffer);
    });

    console.log('Image uploaded to Cloudinary. URL:', result.secure_url);

    // Dodaj URL slike u korisnički dokument
    const user = await User.findById(userId);
    if (!user) {
      console.error('User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    user.profilePictures.push(result.secure_url);
    await user.save();

    console.log('Profile picture added to user profile:', user.profilePictures);

    res.status(200).json({ message: 'Image uploaded successfully', imageUrl: result.secure_url });
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
