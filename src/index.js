const chromium = require('chrome-aws-lambda');
const hb = require('handlebars');
const core = require("@actions/core");
const { readFileSync } = require("fs");
const S3 = require('aws-sdk/clients/s3');
const { PDFDocument } = require("pdf-lib");
const { setOutput } = require("@actions/core");

const Bucket = core.getInput('bucket');
const baseUrl = core.getInput('baseUrl');
const basePdf = core.getInput('basePdf');

const s3 = new S3({
	region: core.getInput('region'),
	accessKeyId: core.getInput('accessKeyId'),
	secretAccessKey: core.getInput('secretAccessKey')
})

async function appendPDF(firstPdf, secondPdf) {
	console.log('Merging with base PDF')
	const first = await PDFDocument.load(firstPdf);
	const second = await PDFDocument.load(secondPdf);
	const pagesArray = await second.copyPages(first, first.getPageIndices());
	for (const page of pagesArray) {
		second.addPage(page);
	}
	return await second.save()
}

async function getCurrentDate() {
	/**
	 * getting current date
	 */
	const d = new Date();
	return [
		('0' + d.getDate()).slice(-2),
		('0' + (d.getMonth() + 1)).slice(-2),
		d.getFullYear()
	].join('-');
}

async function getVersion(type) {
	/**
	 * getting current version from input
	 */
	const version = core.getInput('version');

	if (type === 'short') {
		return version.split('.')[0]
	}

	return version;
}

async function getAsset(file) {
	const params = {
		Bucket,
		Key: `assets/${file}`
	}

	const {Body} = await s3.getObject(params).promise().catch((err) => console.log(err));
	return Body
}

async function getAllFiles() {
	/**
	 * getting all previous PDFs (above 1000 as well)
	 */
	let isTruncated = true;
	let marker;
	const elements = [];
	while (isTruncated) {
		let params = {Bucket, Prefix: "versions/"};
		if (marker) params.Marker = marker;
		try {
			const response = await s3.listObjects(params).promise();
			const objectsInFolder = response.Contents.filter((i => i.Size > 0))

			objectsInFolder.forEach(item => {
				elements.push(item.Key.split('/')[1]);
			});
			isTruncated = response.IsTruncated;
			if (isTruncated) {
				marker = response.Contents.slice(-1)[0].Key.split('/')[1];
			}
		} catch (error) {
			throw error;
		}
	}
	return elements;
}

async function checkIfFileExist(fileName) {
	const params = {
		Bucket,
		Key: `versions/${fileName}`,
	}

	return await s3.getObject(params)
		.promise()
		.then(() => {
			console.log("This PDF? 'Tis already there...");
			const PDF_URL = `${baseUrl}/versions/${fileName}`
			setOutput('url', PDF_URL);
			return true;
		})
		.catch(() => {
			console.log("Item doesn\'t exists, onto creation...");
			return false;
	});
}

async function mapAllFiles(currentPdfName) {
	/**
	 * map all version files to usable format for handlebars
	 */
	const fileExists = await checkIfFileExist(currentPdfName);
	if (fileExists) return false;

	const previousFiles = await getAllFiles();
	const mapped = [];

	previousFiles.forEach(item => {
		mapped.push({build: item.split('-')[0], date: item.match(/\d{2}-\d{2}-\d{4}/)[0]});
	})

	return mapped;
}

async function getTemplateHtml(fileName) {
	/**
	 * getting the html template
	 */
	console.log(`Loading ${fileName} file in memory`);
	const templateBuffer = await getAsset(fileName).catch((err) => console.log("Can' load template: ", err));
	return Buffer.from(templateBuffer).toString('utf8');
}

async function generatePdf() {
	const name = `${await getVersion()}-${await getCurrentDate()}.pdf`;
	const mapped = await mapAllFiles(name);
	if (!mapped) return;

	/**
	 * downloading base PDF and templates
	 */
	const basePDF = await getAsset(basePdf);
	const bodyTemplate = await getTemplateHtml('pdf.html');
	const headerTemplate = await getTemplateHtml('header.html');
	const footerTemplate = await getTemplateHtml('footer.html');

	/**
	 * creating the template from html using handlebars
	 */
	const template = await hb.compile(bodyTemplate, {strict: true});
	const html = template({
		version: await getVersion(),
		shortVersion: await getVersion('short'),
		releaseDate: await getCurrentDate(),
		previousFiles: mapped,
		manufacturer: readFileSync(__dirname + '/assets/manufacturer.png').toString('base64'),
		dateManufacturer: readFileSync(__dirname + '/assets/dateManufacturer.png').toString('base64'),
		ref: readFileSync(__dirname + '/assets/ref.png').toString('base64'),
		lot: readFileSync(__dirname + '/assets/lot.png').toString('base64'),
		udi: readFileSync(__dirname + '/assets/udi.png').toString('base64'),
		ukca: readFileSync(__dirname + '/assets/ukca.png').toString('base64'),
		caution: readFileSync(__dirname + '/assets/caution.png').toString('base64'),
		eifu: readFileSync(__dirname + '/assets/eifu.png').toString('base64')
	});

	/**
	 * launching puppeteer to generate the version PDF
	 */
	console.log(`Starting PDF generation with ${name} name`)
	const browser = await chromium.puppeteer.launch({
		args: ['--no-sandbox', '--disable-setuid-sandbox'],

	});

	const page = await browser.newPage();
	await page.setContent(html, {waitUntil: ['load', 'domcontentloaded', 'networkidle0']})
	await page.addStyleTag({path: __dirname + '/styles/pdf.css'});
	const pdf = await page.pdf({
		format: 'A4',
		printBackground: true,
		displayHeaderFooter: true,
		headerTemplate,
		footerTemplate,
		margin: {
			top: '4cm',
			bottom: '2.3cm',
			right: '2cm',
			left: '1.9cm',
		},
	})
	await browser.close();

	const mergedPdf = await appendPDF(basePDF, pdf)
	console.log("Done, starting the upload...")

	/**
	 * uploading PDF to S3
	 */
	await s3.upload({
		Bucket,
		Body: Buffer.from(mergedPdf),
		Key: `versions/${name}`,
		ContentType: 'application/pdf',
		ContentDisposition: 'inline',
		ACL: 'public-read'
	})
		.promise()
		.then((res) => core.setOutput('url', res.Location))
		.catch((err) => core.setFailed(err.message));
}

generatePdf().catch((err) => core.setFailed(err.message));
