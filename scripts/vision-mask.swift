// macOS Vision's subject lifting for segment.ts: for each pair of arguments, the mask of the image
// at the first path, written as a greyscale PNG to the second.
// `swift scripts/vision-mask.swift <in> <out> [<in> <out> ...]`

import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

let context = CIContext()
let paths = Array(CommandLine.arguments.dropFirst())

for i in stride(from: 0, to: paths.count - 1, by: 2) {
	let input = CIImage(contentsOf: URL(fileURLWithPath: paths[i]))!
	let extent = input.extent
	let image = context.createCGImage(input, from: extent)!
	let request = VNGenerateForegroundInstanceMaskRequest()
	let handler = VNImageRequestHandler(cgImage: image)
	try handler.perform([request])

	var mask = CIImage(color: .black).cropped(to: extent)
	if let found = request.results?.first {
		let buffer = try found.generateScaledMaskForImage(forInstances: found.allInstances, from: handler)
		mask = CIImage(cvPixelBuffer: buffer)
	}
	let grey = context.createCGImage(
		mask, from: extent, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())!
	let url = URL(fileURLWithPath: paths[i + 1]) as CFURL
	let out = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil)!
	CGImageDestinationAddImage(out, grey, nil)
	guard CGImageDestinationFinalize(out) else { fatalError("Couldn't write \(paths[i + 1])") }
}
