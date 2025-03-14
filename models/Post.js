const {Schema,model}= require("mongoose")

const PostSchema= new Schema({

    title:{type:String,required:true},
    content:{type:String,required:true},
    author:{type:Schema.Types.ObjectId,ref:"User",required:true}},
    {timestamps:true})


    module.exports=model("Post",PostSchema)