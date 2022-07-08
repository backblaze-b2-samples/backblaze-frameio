import pprint
from typing import Dict, List, Union

from frameioclient import FrameioClient, Utils
import boto3
import requests
from pydantic import AnyHttpUrl

from config import AWS_SECRET_ACCESS_KEY, AWS_ACCESS_KEY_ID, S3_BUCKET, FIO_TOKEN,S3_ENDPOINT

client = FrameioClient(FIO_TOKEN)


def backup_to_s3(s3_path: str, url: AnyHttpUrl) -> str:
    """Backs up a file to S3, given a path within S3 you want it located and the asset to stream

    Args:
        s3_path (str): Path you want the file to land in S3
        url (AnyHttpUrl): The Frame.io asset URL

    Returns:
        str: S3 URI
    """
    session = requests.Session()
    response = session.get(url, stream=True)

    s3 = boto3.client(
        "s3",
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        endpoint_url=S3_ENDPOINT
    )

    with response as part:
        part.raw.decode_content = True
        conf = boto3.s3.transfer.TransferConfig(
            multipart_threshold=10000, max_concurrency=5
        )
        s3_result = s3.upload_fileobj(part.raw, S3_BUCKET, s3_path, Config=conf)

    return s3_result


def format_bytes(size, type="speed"):
    """
    Convert bytes to KB/MB/GB/TB/s
    """
    # 2**10 = 1024
    power = 2 ** 10
    n = 0
    power_labels = {0: 'B', 1: 'KB', 2: 'MB', 3: 'GB', 4: 'TB'}

    while size > power:
        size /= power
        n += 1

    formatted = " ".join((str(round(size, 2)), power_labels[n]))

    if type == "speed":
        return formatted + "/s"

    elif type == "size":
        return formatted


def build_payload(payload: Dict) -> Dict:
    # Get asset and then figure out the parent asset id
    parent_asset_id = client.assets.get(payload["resource"]["id"])["parent_id"]

    # Grab the following values
    project_id = payload["project"]["id"]
    asset_id = payload["resource"]["id"]

    # Fetch stats for those values
    project_info = client.projects.get(project_id)
    print(project_info)
    pprint.pprint(vars(Utils))
    project_response = {
        "name": f"📓: {project_info['name']} - {format_bytes(project_info['storage'], type='size')}",
        "value": project_info["id"],
    }

    folder_info = client.assets.get(parent_asset_id)
    folder_response = {
        "name": f"📁: {folder_info['name']} - {format_bytes(folder_info['filesize'], type='size')}",
        "value": folder_info["id"],
    }

    asset_info = client.assets.get(asset_id)
    asset_response = {
        "name": f"🎞️: {asset_info['name']} - {format_bytes(asset_info['filesize'], type='size')}",
        "value": asset_info["id"],
    }

    destination_options = [
        {"name": "Backblaze Location 1: [Bucket Name]", "value": "backblaze1"},
        {"name": "Backblaze Location 2: [Bucket Name]", "value": "backblaze2"},
    ]

    # Build response
    response = {
        "title": "Frame.io → External Archive",
        "description": f"The {project_info['name']} project contains: \n - {project_info['folder_count']:,} Folders\n - {project_info['file_count']:,} Assets \n\nThe parent folder {folder_info['name']} contains: \n - {folder_info['item_count']:,} items",
        "fields": [
            {
                "type": "select",
                "label": "Destination?",
                "name": "destination",
                "options": destination_options,
            },
            {
                "type": "select",
                "label": "What would you like to archive?",
                "name": "resource_id",
                "options": [project_response, asset_response],
            },
        ],
    }

    if folder_info["name"] != "root":
        response["fields"][1]["options"].append(folder_response)

    return response


def get_assets_recursively(asset_id):
    assets = list(client.assets.get_children(asset_id))
    print("Number of assets at top level", len(assets))

    for asset in assets:
        print(
            f"Type: {asset['_type']}, Name: {asset['name']}, Children: {asset['item_count']}"
        )

        if asset["_type"] == "file":
            # Don't do nothing, it's a file!
            continue

        if asset["_type"] == "version_stack":
            print("Grabbing top item from version stack")
            versions = client.assets.get_children(asset["id"])
            asset = versions[0]  # re-assign on purpose
            continue

        if asset["_type"] == "folder":
            # Recursively fetch the contents of the folder
            temp_assets = get_assets_recursively(asset["id"])
            assets.extend({asset["id"]: temp_assets})

    return assets


def archive_data(payload: Dict) -> Dict:
    # Archive the item mentioned in the data dict
    resource = payload["data"]["resource_id"]

    archival_manifest = []
    found_items = False

    # First try as a single asset
    try:
        asset = client.assets.get(resource)
        project = client.projects.get(asset["project_id"])
        # print(f"Project: {project}")
        archival_manifest.append(asset)
        found_items = True
    except Exception as e:
        print(e)

    # Test for a project (archive the whole thing)
    if found_items == False:
        try:
            project = client.projects.get(resource)
            # print(f"Project: {project}")
            assets = client.helpers.get_assets_recursively(project["root_asset_id"])
            # assets = get_assets_recursively(project["root_asset_id"])
            archival_manifest.extend(assets)
            found_items = True
        except Exception as e:
            print(e)

    # Test for a folder
    if found_items == False:
        try:
            assets = client.helpers.get_assets_recursively(project["root_asset_id"], slim=False)
            archival_manifest.extend(assets)
            project = client.projects.get(assets[0]["project_id"])
            # print(f"Project: {project}")
            found_items = True
        except Exception as e:
            print(e)

    recursive_backup(project, archival_manifest)


def recursive_backup(project: str, manifest: Union[List, Dict], parents: List = []):
    if type(manifest) == dict:
        asset = manifest

        # Attempt to add child items from a list
        try:
            if type(asset['children']) == list:
                folder = asset['children']
                temp_parents = asset['name']
                for asset in folder:
                    recursive_backup(project, asset, [*parents, temp_parents])
        except Exception as e:
            print(e)

        try:
            print(
                f"Backing up: {asset['name']}, {format_bytes(asset['filesize'], type='size')}"
            )

            # Remove this in a sec
            if len(parents) >= 1:
                path = '/'.join(parents)
                backup_to_s3(
                    f"{project['name']}/{path}/{asset['name']}",
                    asset["original"]
                )
            else:
                backup_to_s3(
                    f"{project['name']}/{asset['name']}",
                    asset["original"]
                )

        except Exception as e:
            print(e)

    elif type(manifest) == list:
        for asset in manifest:
            temp_parents = []
            
            # Handle nested folder
            if type(asset['children']) == dict or list:
                # Add folder name to path list
                temp_parents.append(asset['name'])
                for item in asset['children']:
                    recursive_backup(project, item, [*parents, *temp_parents])

            # Handle items at folder root
            else:
                recursive_backup(project, asset)

    return True
